import Account from "../models/Account.js";
import AccountLedgerEntry from "../models/AccountLedgerEntry.js";
import asyncHandler from "../middleware/asyncHandler.js";
import { successResponse } from "../utils/apiResponse.js";
import { createCrudController } from "./crudController.js";
import ApiError from "../utils/ApiError.js";
import mongoose from "mongoose";
import { createHash } from "node:crypto";
import Transaction from "../models/Transaction.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { applyTransactionAccountEffects } from "../services/accountingEngine.js";

const crud = createCrudController(Account, "Account");

export const reconcileAccounts = asyncHandler(async (req, res) => {
  const [accounts, totals] = await Promise.all([
    Account.find({ userId: req.userId }).sort({ name: 1 }),
    AccountLedgerEntry.aggregate([
      { $match: { userId: req.userId } },
      { $group: { _id: "$account", ledgerTotal: { $sum: "$delta" }, entries: { $sum: 1 } } }
    ])
  ]);
  const totalsByAccount = new Map(totals.map((item) => [String(item._id), item]));
  const results = accounts.map((account) => {
    const ledger = totalsByAccount.get(String(account._id));
    const expectedBalance = Number(account.openingBalance || 0) + Number(ledger?.ledgerTotal || 0);
    const actualBalance = Number(account.currentBalance || 0);
    return {
      account: account._id,
      name: account.name,
      expectedBalance,
      actualBalance,
      difference: Number((actualBalance - expectedBalance).toFixed(2)),
      ledgerEntries: ledger?.entries || 0,
      reconciled: Math.abs(actualBalance - expectedBalance) < 0.005
    };
  });
  successResponse(res, { checkedAt: new Date(), accounts: results, reconciled: results.every((item) => item.reconciled) }, "Account reconciliation completed");
});

export const getAccountLedger = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new ApiError("Invalid account id", 400);
  const account = await Account.findOne({ _id: req.params.id, userId: req.userId });
  if (!account) throw new ApiError("Account not found", 404);
  const entries = await AccountLedgerEntry.find({ userId: req.userId, account: account._id })
    .sort({ createdAt: -1 })
    .populate({ path: "transaction", match: { userId: req.userId }, select: "type amount note transactionDate transactionTime status" })
    .populate({ path: "settlement", match: { userId: req.userId }, populate: [
      { path: "person", match: { userId: req.userId }, select: "name" },
      { path: "sourceTransaction", match: { userId: req.userId }, select: "type note" }
    ] });
  successResponse(res, { account, entries }, "Account history fetched");
});

const update = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new ApiError("Invalid resource id", 400);
  const requestKey = String(req.get("Idempotency-Key") || "").trim();
  if (!requestKey || requestKey.length > 128) throw new ApiError("A valid request key is required", 400);
  const payloadHash = createHash("sha256").update(JSON.stringify({ path: req.path, body: req.body })).digest("hex");
  const prior = await FinancialRequest.findOne({ userId: req.userId, requestKey });
  if (prior) {
    if (prior.payloadHash !== payloadHash) throw new ApiError("This request key was already used for a different action", 409);
    const account = await Account.findOne({ _id: req.params.id, userId: req.userId });
    if (!account) throw new ApiError("Account not found", 404);
    successResponse(res, account, "Account updated successfully.");
    return;
  }

  const session = await mongoose.startSession();
  try {
    let account;
    await session.withTransaction(async () => {
      const existing = await Account.findOne({ _id: req.params.id, userId: req.userId }).session(session);
      if (!existing) throw new ApiError("Account not found", 404);
      if (req.body.openingBalance !== undefined && Number(req.body.openingBalance) !== Number(existing.openingBalance)) {
        throw new ApiError("Opening balance cannot be changed after account creation", 400);
      }
      const targetBalance = Number(req.body.currentBalance ?? existing.currentBalance);
      if (!Number.isFinite(targetBalance)) throw new ApiError("Current balance must be a valid number", 400);
      const delta = Number((targetBalance - Number(existing.currentBalance || 0)).toFixed(2));
      const safeFields = { name: req.body.name, type: req.body.type, icon: req.body.icon, isActive: req.body.isActive };
      Object.keys(safeFields).forEach((key) => safeFields[key] === undefined && delete safeFields[key]);
      account = await Account.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId },
        { $set: safeFields },
        { new: true, runValidators: true, session }
      );
      const transactions = [];
      if (delta !== 0) {
        const now = new Date();
        const [adjustment] = await Transaction.create([{
          userId: req.userId,
          createdBy: req.userId,
          requestKey,
          type: "BALANCE_ADJUSTMENT",
          amount: Math.abs(delta),
          adjustmentDirection: delta > 0 ? "INCREASE" : "DECREASE",
          account: existing._id,
          note: String(req.body.adjustmentNote || "Balance adjustment").slice(0, 500),
          transactionDate: now,
          transactionTime: now.toTimeString().slice(0, 5),
          status: "ACTIVE",
          repaymentStatus: "NONE"
        }], { session });
        transactions.push(adjustment);
        await applyTransactionAccountEffects(adjustment, req.userId, session);
      }
      account = await Account.findOne({ _id: req.params.id, userId: req.userId }).session(session);
      await FinancialRequest.create([{
        userId: req.userId,
        requestKey,
        payloadHash,
        transactionIds: transactions.map((item) => item._id),
        createdBy: req.userId
      }], { session });
    });
    successResponse(res, account, "Account updated successfully.");
  } catch (error) {
    if (error.code === 11000) {
      const receipt = await FinancialRequest.findOne({ userId: req.userId, requestKey });
      if (receipt?.payloadHash === payloadHash) {
        const account = await Account.findOne({ _id: req.params.id, userId: req.userId });
        successResponse(res, account, "Account updated successfully.");
        return;
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
});

const create = asyncHandler(async (req, res, next) => {
  if (Number(req.body.currentBalance) !== Number(req.body.openingBalance)) {
    return next(new ApiError("New account current balance must match its opening balance", 400));
  }
  return crud.create(req, res, next);
});

export default { ...crud, create, update };
