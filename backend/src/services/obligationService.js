import Obligation from "../models/Obligation.js";
import SettlementAllocation from "../models/SettlementAllocation.js";
import Transaction from "../models/Transaction.js";
import Settlement from "../models/Settlement.js";
import ObligationEvent from "../models/ObligationEvent.js";
import ObligationMigration from "../models/ObligationMigration.js";
import Notification from "../models/Notification.js";
import mongoose from "mongoose";
import ApiError from "../utils/ApiError.js";
import { PAYABLE_TYPES, RECEIVABLE_TYPES } from "../utils/financeRules.js";
import { recordObligationStatusActivity } from "./activityEventService.js";

export function obligationDetails(transaction, sourceType) {
  if (!transaction.person || (!PAYABLE_TYPES.includes(transaction.type) && !RECEIVABLE_TYPES.includes(transaction.type))) return null;
  return {
    sourceTransaction: transaction._id,
    person: transaction.person,
    direction: RECEIVABLE_TYPES.includes(transaction.type) ? "RECEIVABLE" : "PAYABLE",
    sourceType: sourceType || (transaction.type === "PAID_FOR_SOMEONE" && transaction.parentTransaction ? "SPLIT_SHARE" : transaction.type),
    originalAmount: Number(transaction.originalAmount ?? transaction.amount),
    settledAmount: 0,
    remainingAmount: Number(transaction.originalAmount ?? transaction.amount),
    dueDate: transaction.dueDate,
    status: "PENDING"
  };
}

export async function createObligationForTransaction(transaction, userId, session, sourceType) {
  const details = obligationDetails(transaction, sourceType);
  if (!details) return null;
  details.status = obligationStatus(details);
  const [obligation] = await Obligation.create([{
    userId,
    ...details,
    createdBy: transaction.createdBy || userId,
    metadata: { sourceRequestKey: transaction.requestKey || null }
  }], { session });
  await ObligationEvent.create([{
    userId,
    obligation: obligation._id,
    sourceTransaction: transaction._id,
    eventType: "CREATED",
    amount: obligation.originalAmount,
    statusAfter: obligation.status,
    remainingAfter: obligation.remainingAmount,
    createdBy: transaction.createdBy || userId,
    metadata: { sourceType: obligation.sourceType }
  }], { session });
  return obligation;
}

export function obligationStatus({ remainingAmount, settledAmount, dueDate, cancelled = false }, now = new Date()) {
  if (cancelled) return "CANCELLED";
  if (Number(remainingAmount) <= 0) return "SETTLED";
  if (dueDate && new Date(dueDate).setHours(0, 0, 0, 0) < new Date(now).setHours(0, 0, 0, 0)) return "OVERDUE";
  if (Number(settledAmount) > 0) return "PARTIALLY_SETTLED";
  return "PENDING";
}

export async function recalculateObligation(obligation, session, now = new Date()) {
  if (obligation.status === "CANCELLED") return obligation;
  const allocations = await SettlementAllocation.aggregate([
    { $match: { userId: obligation.userId, obligation: obligation._id } },
    { $lookup: { from: "settlements", localField: "settlement", foreignField: "_id", as: "settlement" } },
    { $unwind: "$settlement" },
    { $match: {
      "settlement.userId": obligation.userId,
      "settlement.person": obligation.person,
      "settlement.status": "ACTIVE",
      "settlement.direction": { $in: obligation.direction === "PAYABLE" ? ["PAYMENT", "PAID_BY_ME"] : ["RECEIPT", "RECEIVED_BY_ME"] }
    } },
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]).session(session);
  const settledAmount = Number(allocations[0]?.total || 0);
  const originalAmount = Number(obligation.originalAmount);
  if (settledAmount - originalAmount > 0.005) throw new ApiError("Settlement allocations exceed the obligation amount", 409);
  const remainingAmount = Number(Math.max(0, originalAmount - settledAmount).toFixed(2));
  const status = obligationStatus({ settledAmount, remainingAmount, dueDate: obligation.dueDate }, now);
  const previousStatus = obligation.status;
  const previousRemaining = Number(obligation.remainingAmount || 0);
  obligation.settledAmount = settledAmount;
  obligation.remainingAmount = remainingAmount;
  obligation.status = status;
  obligation.settledAt = status === "SETTLED" ? (obligation.settledAt || now) : undefined;
  obligation.version = Number(obligation.version || 0) + 1;
  await obligation.save({ session });

  await Transaction.updateOne(
    { _id: obligation.sourceTransaction, userId: obligation.userId },
    { $set: { originalAmount, remainingAmount, repaymentStatus: remainingAmount === 0 ? "PAID" : settledAmount > 0 ? "PARTIAL" : "PENDING" } },
    { session }
  );
  const latestAllocation = await SettlementAllocation.findOne({ userId: obligation.userId, obligation: obligation._id }).sort({ createdAt: -1 }).session(session);
  if (latestAllocation && !await ObligationEvent.exists({ userId: obligation.userId, allocation: latestAllocation._id }).session(session)) await ObligationEvent.create([{
    userId: obligation.userId,
    obligation: obligation._id,
    sourceTransaction: obligation.sourceTransaction,
    settlement: latestAllocation.settlement,
    allocation: latestAllocation._id,
    eventType: "SETTLEMENT_ALLOCATED",
    amount: latestAllocation.amount,
    statusBefore: previousStatus,
    statusAfter: status,
    remainingBefore: previousRemaining,
    remainingAfter: remainingAmount,
    createdBy: obligation.createdBy || obligation.userId
  }], { session });
  return obligation;
}

export async function ensureUserObligations(userId) {
  if (await ObligationMigration.exists({ userId })) return;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (await ObligationMigration.exists({ userId }).session(session)) return;
      const transactions = await Transaction.find({
        userId,
        type: { $in: [...PAYABLE_TYPES, ...RECEIVABLE_TYPES] },
        person: { $exists: true, $ne: null }
      }).session(session);
      for (const transaction of transactions) {
        let obligation = await Obligation.findOne({ userId, sourceTransaction: transaction._id }).session(session);
        if (obligation) continue;
        const legacySettlements = await Settlement.find({
          userId,
          sourceTransaction: transaction._id,
          status: { $ne: "CANCELLED" }
        }).session(session);
        const originalAmount = Number(transaction.originalAmount ?? transaction.amount);
        const settledAmount = Number(legacySettlements.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2));
        if (settledAmount - originalAmount > 0.005) throw new ApiError("Legacy settlements exceed their source obligation", 409);
        const remainingAmount = transaction.status === "CANCELLED" ? 0 : Number(Math.max(0, originalAmount - settledAmount).toFixed(2));
        const details = obligationDetails(transaction);
        if (!details) continue;
        [obligation] = await Obligation.create([{
          userId,
          ...details,
          originalAmount,
          settledAmount,
          remainingAmount,
          status: obligationStatus({ settledAmount, remainingAmount, dueDate: transaction.dueDate, cancelled: transaction.status === "CANCELLED" }),
          settledAt: remainingAmount === 0 ? legacySettlements.length ? legacySettlements[legacySettlements.length - 1].settlementDate : new Date() : undefined,
          createdBy: transaction.createdBy || userId,
          metadata: { migratedFromTransaction: String(transaction._id) }
        }], { session });
        await ObligationEvent.create([{
          userId,
          obligation: obligation._id,
          sourceTransaction: transaction._id,
          eventType: "CREATED",
          amount: originalAmount,
          statusAfter: obligation.status,
          remainingAfter: remainingAmount,
          createdBy: transaction.createdBy || userId,
          metadata: { migrated: true }
        }], { session });
        for (const legacy of legacySettlements) {
          await SettlementAllocation.updateOne(
            { userId, settlement: legacy._id, obligation: obligation._id },
            { $setOnInsert: { userId, settlement: legacy._id, obligation: obligation._id, amount: legacy.amount, createdBy: legacy.createdBy || userId } },
            { upsert: true, session }
          );
          const allocation = await SettlementAllocation.findOne({ userId, settlement: legacy._id, obligation: obligation._id }).session(session);
          await ObligationEvent.create([{
            userId,
            obligation: obligation._id,
            sourceTransaction: transaction._id,
            settlement: legacy._id,
            allocation: allocation?._id,
            eventType: "SETTLEMENT_ALLOCATED",
            amount: legacy.amount,
            createdBy: transaction.createdBy || userId,
            metadata: { migrated: true }
          }], { session });
          if (["PAID_BY_ME", "RECEIVED_BY_ME"].includes(legacy.direction)) {
            legacy.direction = legacy.direction === "PAID_BY_ME" ? "PAYMENT" : "RECEIPT";
            legacy.totalAmount = legacy.amount;
            await legacy.save({ session });
          }
        }
        await Notification.updateMany(
          { userId, transaction: transaction._id, obligation: { $exists: false } },
          { $set: { obligation: obligation._id } },
          { session }
        );
        transaction.remainingAmount = remainingAmount;
        transaction.repaymentStatus = remainingAmount <= 0 ? "PAID" : settledAmount > 0 ? "PARTIAL" : "PENDING";
        await transaction.save({ session });
      }
      await ObligationMigration.create([{ userId, completedAt: new Date(), createdBy: userId }], { session });
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
  } finally {
    await session.endSession();
  }
}

export async function refreshUserObligationStatuses(userId, now = new Date()) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const obligations = await Obligation.find({ userId, status: { $nin: ["SETTLED", "CANCELLED"] }, remainingAmount: { $gt: 0 } }).session(session);
      for (const obligation of obligations) {
        const nextStatus = obligationStatus(obligation, now);
        if (nextStatus === obligation.status) continue;
        const previous = obligation.status;
        obligation.status = nextStatus;
        obligation.version = Number(obligation.version || 0) + 1;
        await obligation.save({ session });
        await ObligationEvent.create([{
          userId,
          obligation: obligation._id,
          sourceTransaction: obligation.sourceTransaction,
          eventType: "CORRECTED",
          statusBefore: previous,
          statusAfter: nextStatus,
          remainingBefore: obligation.remainingAmount,
          remainingAfter: obligation.remainingAmount,
          createdBy: userId,
          metadata: { reason: "due-date status transition" }
        }], { session });
        await recordObligationStatusActivity({
          obligation,
          statusBefore: previous,
          statusAfter: nextStatus,
          remainingBefore: obligation.remainingAmount,
          remainingAfter: obligation.remainingAmount,
          userId,
          session,
          reason: "due-date status transition"
        });
      }
    });
  } finally {
    await session.endSession();
  }
}
