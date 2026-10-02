import { createHash } from "node:crypto";
import mongoose from "mongoose";
import Account from "../models/Account.js";
import FinancialRequest from "../models/FinancialRequest.js";
import Obligation from "../models/Obligation.js";
import ObligationEvent from "../models/ObligationEvent.js";
import Person from "../models/Person.js";
import Settlement from "../models/Settlement.js";
import SettlementAllocation from "../models/SettlementAllocation.js";
import Transaction from "../models/Transaction.js";
import Notification from "../models/Notification.js";
import { applyAccountLedgerDelta } from "../services/accountingEngine.js";
import { recordSettlementActivity, recordSettlementReversalActivity } from "../services/activityEventService.js";
import { ensureUserObligations, recalculateObligation, refreshUserObligationStatuses } from "../services/obligationService.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { successResponse } from "../utils/apiResponse.js";

function requestKey(req) {
  const key = String(req.get("Idempotency-Key") || "").trim();
  if (!key || key.length > 128) throw new ApiError("A valid request key is required", 400);
  return key;
}

function payloadHash(req) {
  return createHash("sha256").update(JSON.stringify({ method: req.method, path: req.path, body: req.body })).digest("hex");
}

export const listObligations = asyncHandler(async (req, res) => {
  await ensureUserObligations(req.userId);
  await refreshUserObligationStatuses(req.userId);
  const filter = { userId: req.userId };
  if (["PAYABLE", "RECEIVABLE"].includes(req.query.direction)) filter.direction = req.query.direction;
  if (req.query.person) filter.person = req.query.person;
  if (req.query.status) filter.status = req.query.status;
  if (["OVERDUE", "TODAY", "UPCOMING"].includes(req.query.due)) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    filter.remainingAmount = { $gt: 0 };
    filter.dueDate = req.query.due === "TODAY" ? { $gte: today, $lt: tomorrow } : req.query.due === "OVERDUE" ? { $lt: today } : { $gte: tomorrow };
    filter.status = { $nin: ["SETTLED", "CANCELLED"] };
  }
  if (req.query.history !== "true" && !filter.status) filter.status = { $ne: "CANCELLED" };
  const obligations = await Obligation.find(filter)
    .sort({ dueDate: 1, createdAt: -1 })
    .populate({ path: "person", match: { userId: req.userId }, select: "name" })
    .populate({
      path: "sourceTransaction",
      match: { userId: req.userId },
      select: "type amount originalAmount note transactionDate transactionTime category account tags dueDate",
      populate: [
        { path: "account", match: { userId: req.userId }, select: "name type" },
        { path: "category", match: { userId: req.userId }, select: "name type color" },
        { path: "tags", match: { userId: req.userId }, select: "name color" }
      ]
    });
  successResponse(res, obligations, "Obligations fetched");
});

export const getObligation = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new ApiError("Invalid obligation id", 400);
  await ensureUserObligations(req.userId);
  await refreshUserObligationStatuses(req.userId);
  const obligation = await Obligation.findOne({ _id: req.params.id, userId: req.userId })
    .populate({ path: "person", match: { userId: req.userId }, select: "name" })
    .populate({ path: "sourceTransaction", match: { userId: req.userId }, select: "type amount originalAmount note transactionDate transactionTime category dueDate account", populate: { path: "account", match: { userId: req.userId }, select: "name type" } });
  if (!obligation) throw new ApiError("Obligation not found", 404);
  const allocations = await SettlementAllocation.find({ obligation: obligation._id, userId: req.userId })
    .sort({ createdAt: 1 })
    .populate({ path: "settlement", match: { userId: req.userId }, populate: { path: "account", select: "name type" } });
  const events = await ObligationEvent.find({ obligation: obligation._id, userId: req.userId }).sort({ createdAt: 1 }).populate({ path: "settlement", match: { userId: req.userId }, select: "direction totalAmount amount settlementDate settlementTime note account" });
  successResponse(res, { obligation, allocations: allocations.filter((item) => item.settlement), events }, "Obligation history fetched");
});

export const listSettlementHistory = asyncHandler(async (req, res) => {
  await ensureUserObligations(req.userId);
  await refreshUserObligationStatuses(req.userId);
  const filter = { userId: req.userId };
  const dateRange = {};
  if (req.query.startDate) dateRange.$gte = new Date(req.query.startDate);
  if (req.query.endDate) dateRange.$lt = new Date(`${req.query.endDate}T23:59:59.999`);
  if (req.query.month && req.query.year) {
    dateRange.$gte = new Date(Number(req.query.year), Number(req.query.month) - 1, 1);
    dateRange.$lt = new Date(Number(req.query.year), Number(req.query.month), 1);
  }
  if (Object.keys(dateRange).length) filter.settlementDate = dateRange;
  if (req.query.person) filter.person = req.query.person;
  if (req.query.account) filter.account = req.query.account;
  if (["ACTIVE", "CANCELLED"].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.direction === "PAYABLE") filter.direction = { $in: ["PAYMENT", "PAID_BY_ME"] };
  if (req.query.direction === "RECEIVABLE") filter.direction = { $in: ["RECEIPT", "RECEIVED_BY_ME"] };
  const settlements = await Settlement.find(filter)
    .sort({ settlementDate: -1, settlementTime: -1, createdAt: -1 })
    .populate({ path: "person", match: { userId: req.userId }, select: "name" })
    .populate({ path: "account", match: { userId: req.userId }, select: "name type" });
  const allocations = await SettlementAllocation.find({ userId: req.userId, settlement: { $in: settlements.map((item) => item._id) } })
    .populate({ path: "obligation", match: { userId: req.userId }, populate: { path: "sourceTransaction", match: { userId: req.userId }, select: "type note transactionDate" } });
  const allocationEvents = await ObligationEvent.find({
    userId: req.userId,
    allocation: { $in: allocations.map((item) => item._id) }
  }).sort({ createdAt: 1 });
  const latestEventByAllocation = allocationEvents.reduce((map, event) => map.set(String(event.allocation), event), new Map());
  const bySettlement = allocations.reduce((map, item) => {
    if (item.obligation) {
      const event = latestEventByAllocation.get(String(item._id));
      map.set(String(item.settlement), [...(map.get(String(item.settlement)) || []), {
        ...item.toObject(),
        remainingAfter: event?.remainingAfter,
        statusAfter: event?.statusAfter,
        eventType: event?.eventType
      }]);
    }
    return map;
  }, new Map());
  const history = settlements.map((item) => ({ ...item.toObject(), allocations: bySettlement.get(String(item._id)) || [] }));
  const selectedSources = req.query.source === "PAID_FOR_SOMEONE_AND_SPLIT"
    ? ["PAID_FOR_SOMEONE", "SPLIT_SHARE"]
    : ["BORROW", "LEND", "PAID_FOR_SOMEONE", "PAID_BY_SOMEONE", "SPLIT_SHARE"].includes(req.query.source)
      ? [req.query.source]
      : [];
  const sourceHistory = selectedSources.length
    ? history.flatMap((item) => {
      const allocationsForSource = item.allocations.filter((allocation) => selectedSources.includes(allocation.obligation?.sourceType));
      if (!allocationsForSource.length) return [];
      const totalAmount = Number(allocationsForSource.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0).toFixed(2));
      return [{ ...item, totalAmount, amount: totalAmount, allocations: allocationsForSource }];
    })
    : history;
  const allowedStatus = ({
    pending: "PENDING",
    partial: "PARTIALLY_SETTLED",
    settled: "SETTLED",
    overdue: "OVERDUE"
  })[req.query.balanceStatus];
  const filteredHistory = allowedStatus
    ? sourceHistory.flatMap((item) => {
      const allocationsForStatus = item.allocations.filter((allocation) => {
        const remainingAfter = allocation.remainingAfter;
        const originalAmount = Number(allocation.obligation?.originalAmount || 0);
        if (remainingAfter != null) {
          if (req.query.balanceStatus === "settled") return Number(remainingAfter) <= 0;
          if (req.query.balanceStatus === "partial") return Number(remainingAfter) > 0 && Number(remainingAfter) < originalAmount;
          if (req.query.balanceStatus === "pending") return allocation.statusAfter === "PENDING";
          if (req.query.balanceStatus === "overdue") return allocation.statusAfter === "OVERDUE";
        }
        return allocation.statusAfter === allowedStatus || allocation.obligation?.status === allowedStatus;
      });
      if (!allocationsForStatus.length) return [];
      const totalAmount = Number(allocationsForStatus.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0).toFixed(2));
      return [{ ...item, totalAmount, amount: totalAmount, allocations: allocationsForStatus }];
    })
    : sourceHistory;
  successResponse(res, filteredHistory, "Settlement history fetched");
});

export const createSettlement = asyncHandler(async (req, res) => {
  const key = requestKey(req);
  const hash = payloadHash(req);
  const prior = await FinancialRequest.findOne({ userId: req.userId, requestKey: key });
  if (prior) {
    if (prior.payloadHash !== hash) throw new ApiError("This request key was already used for a different action", 409);
    const settlement = await Settlement.findOne({ userId: req.userId, requestKey: key }).populate("account", "name type");
    successResponse(res, settlement, "Settlement recorded successfully.");
    return;
  }

  const allocationsInput = Array.isArray(req.body.allocations)
    ? req.body.allocations
    : [{ obligationId: req.params.id, amount: req.body.amount }];
  if (!allocationsInput.length) throw new ApiError("Choose at least one obligation to settle", 400);
  const accountId = req.body.account;
  if (!mongoose.Types.ObjectId.isValid(accountId)) throw new ApiError("Choose a valid account", 400);
  const normalized = allocationsInput.map((item) => ({ obligationId: String(item.obligationId || item.obligation), amount: Number(item.amount) }));
  if (normalized.some((item) => !mongoose.Types.ObjectId.isValid(item.obligationId) || !Number.isFinite(item.amount) || item.amount <= 0)) {
    throw new ApiError("Each allocation needs a valid obligation and positive amount", 400);
  }
  if (normalized.some((item) => Math.abs(item.amount * 100 - Math.round(item.amount * 100)) > 0.00001)) {
    throw new ApiError("Settlement amounts can have at most two decimal places", 400);
  }
  if (new Set(normalized.map((item) => item.obligationId)).size !== normalized.length) throw new ApiError("An obligation can appear only once per settlement", 400);
  const totalAmount = Number(normalized.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) throw new ApiError("Settlement total must be greater than ₹0", 400);
  const session = await mongoose.startSession();
  let settlement;
  try {
    await session.withTransaction(async () => {
      const account = await Account.findOne({ _id: accountId, userId: req.userId, isActive: true }).session(session);
      if (!account) throw new ApiError("Account not found", 404);
      const ids = normalized.map((item) => new mongoose.Types.ObjectId(item.obligationId));
      const obligations = await Obligation.find({
        _id: { $in: ids },
        userId: req.userId,
        status: { $nin: ["SETTLED", "CANCELLED"] },
        remainingAmount: { $gt: 0 }
      }).session(session);
      if (obligations.length !== normalized.length) throw new ApiError("One or more obligations are no longer open", 409);
      const byId = new Map(obligations.map((item) => [String(item._id), item]));
      const first = obligations[0];
      if (obligations.some((item) => item.direction !== first.direction || String(item.person) !== String(first.person))) {
        throw new ApiError("A settlement can include obligations for one person and one direction only", 400);
      }
      if (!await Person.exists({ _id: first.person, userId: req.userId })) throw new ApiError("Person not found", 404);
      const sourceIds = obligations.map((item) => item.sourceTransaction);
      if (await Transaction.countDocuments({ _id: { $in: sourceIds }, userId: req.userId }) !== sourceIds.length) {
        throw new ApiError("One or more source transactions are unavailable", 404);
      }
      for (const item of normalized) {
        const obligation = byId.get(item.obligationId);
        if (Math.round(item.amount * 100) > Math.round(Number(obligation.remainingAmount) * 100)) throw new ApiError("An allocation cannot exceed its obligation's remaining amount", 400);
      }
      const now = new Date();
      const [created] = await Settlement.create([{
        userId: req.userId,
        person: first.person,
        sourceTransaction: obligations.length === 1 ? first.sourceTransaction : undefined,
        direction: first.direction === "PAYABLE" ? "PAYMENT" : "RECEIPT",
        amount: totalAmount,
        totalAmount,
        account: accountId,
        settlementDate: req.body.settlementDate ? new Date(req.body.settlementDate) : now,
        settlementTime: req.body.settlementTime || now.toTimeString().slice(0, 5),
        note: String(req.body.note || "").slice(0, 500),
        requestKey: key,
        createdBy: req.userId
      }], { session });
      settlement = created;
      await SettlementAllocation.create(normalized.map((item) => ({
        userId: req.userId,
        settlement: created._id,
        obligation: byId.get(item.obligationId)._id,
        amount: item.amount,
        createdBy: req.userId
      })), { session });
      for (const item of normalized) {
        const before = byId.get(item.obligationId);
        const statusBefore = before.status;
        const remainingBefore = Number(before.remainingAmount || 0);
        const obligation = await recalculateObligation(before, session, now);
        const allocation = await SettlementAllocation.findOne({ userId: req.userId, settlement: created._id, obligation: obligation._id }).session(session);
        await recordSettlementActivity({ obligation, settlement: created, allocation, statusBefore, remainingBefore, userId: req.userId, session });
        await Notification.updateMany(
          { userId: req.userId, obligation: obligation._id, status: { $ne: "ARCHIVED" } },
          { $set: { status: "ARCHIVED", deliveryStatus: "CANCELLED" } },
          { session }
        );
      }
      const delta = first.direction === "PAYABLE" ? -totalAmount : totalAmount;
      await applyAccountLedgerDelta({ accountId, delta, userId: req.userId, session, settlement: created });
      await FinancialRequest.create([{
        userId: req.userId,
        requestKey: key,
        payloadHash: hash,
        transactionIds: [],
        createdBy: req.userId
      }], { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const receipt = await FinancialRequest.findOne({ userId: req.userId, requestKey: key });
      if (receipt?.payloadHash === hash) {
        const existing = await Settlement.findOne({ userId: req.userId, requestKey: key });
        successResponse(res, existing, "Settlement recorded successfully.");
        return;
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
  const result = await Settlement.findById(settlement._id).populate("person", "name").populate("account", "name type");
  successResponse(res, result, "Settlement recorded successfully.", 201);
});

export const cancelSettlement = asyncHandler(async (req, res) => {
  const key = requestKey(req);
  const hash = payloadHash(req);
  const prior = await FinancialRequest.findOne({ userId: req.userId, requestKey: key });
  if (prior) {
    if (prior.payloadHash !== hash) throw new ApiError("This request key was already used for a different action", 409);
    const settlement = await Settlement.findOne({ _id: req.params.id, userId: req.userId });
    successResponse(res, settlement, "Settlement reversed successfully.");
    return;
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new ApiError("Invalid settlement id", 400);
  const session = await mongoose.startSession();
  let cancelled;
  try {
    await session.withTransaction(async () => {
      const settlement = await Settlement.findOne({ _id: req.params.id, userId: req.userId, status: "ACTIVE" }).session(session);
      if (!settlement) throw new ApiError("Settlement not found or already reversed", 404);
      const allocations = await SettlementAllocation.find({ userId: req.userId, settlement: settlement._id }).session(session);
      if (!allocations.length) throw new ApiError("Settlement has no allocations and cannot be reversed", 409);
      const obligations = await Obligation.find({ _id: { $in: allocations.map((item) => item.obligation) }, userId: req.userId }).session(session);
      if (obligations.length !== allocations.length) throw new ApiError("Settlement history is incomplete", 409);
      const oldStatuses = new Map(obligations.map((item) => [String(item._id), { status: item.status, remaining: item.remainingAmount }]));
      settlement.status = "CANCELLED";
      settlement.version = Number(settlement.version || 0) + 1;
      await settlement.save({ session });
      const totalAmount = Number(settlement.totalAmount ?? settlement.amount);
      const delta = ["PAYMENT", "PAID_BY_ME"].includes(settlement.direction) ? totalAmount : -totalAmount;
      await applyAccountLedgerDelta({ accountId: settlement.account, delta, userId: req.userId, session, settlement, operation: "REVERSAL" });
      for (const obligation of obligations) {
        await recalculateObligation(obligation, session);
        const old = oldStatuses.get(String(obligation._id));
        const allocation = allocations.find((item) => String(item.obligation) === String(obligation._id));
        await ObligationEvent.create([{
          userId: req.userId,
          obligation: obligation._id,
          sourceTransaction: obligation.sourceTransaction,
          settlement: settlement._id,
          allocation: allocation?._id,
          eventType: "SETTLEMENT_REVERSED",
          amount: allocation?.amount,
          statusBefore: old.status,
          statusAfter: obligation.status,
          remainingBefore: old.remaining,
          remainingAfter: obligation.remainingAmount,
          createdBy: req.userId
        }], { session });
        await recordSettlementReversalActivity({ obligation, settlement, allocation, statusBefore: old.status, remainingBefore: old.remaining, userId: req.userId, session });
        await Notification.updateMany({ userId: req.userId, obligation: obligation._id, status: { $ne: "ARCHIVED" } }, { status: "ARCHIVED" }, { session });
      }
      await FinancialRequest.create([{ userId: req.userId, requestKey: key, payloadHash: hash, transactionIds: [], createdBy: req.userId }], { session });
      cancelled = settlement;
    });
  } catch (error) {
    if (error.code === 11000) {
      const receipt = await FinancialRequest.findOne({ userId: req.userId, requestKey: key });
      if (receipt?.payloadHash === hash) {
        const settlement = await Settlement.findOne({ _id: req.params.id, userId: req.userId });
        successResponse(res, settlement, "Settlement reversed successfully.");
        return;
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
  successResponse(res, cancelled, "Settlement reversed successfully.");
});
