import Account from "../models/Account.js";
import AccountLedgerEntry from "../models/AccountLedgerEntry.js";
import ApiError from "../utils/ApiError.js";
import { accountBalanceDeltas } from "../utils/financeRules.js";

export async function applyTransactionAccountEffects(transaction, userId, session, multiplier = 1) {
  if (transaction.status === "CANCELLED") return;

  for (const effect of accountBalanceDeltas(transaction, multiplier)) {
    await applyAccountLedgerDelta({
      accountId: effect.accountId,
      delta: effect.delta,
      userId,
      session,
      transaction,
      operation: multiplier < 0 ? "REVERSAL" : "POSTED"
    });
  }
}

export async function applyAccountLedgerDelta({ accountId, delta, userId, session, transaction, settlement, operation = "POSTED" }) {
  const account = await Account.findOne({ _id: accountId, userId }).session(session);
  if (!account) throw new ApiError("Account balance update failed", 404);
  if (delta < 0 && account.type !== "CREDIT_CARD" && Number(account.currentBalance || 0) < Math.abs(delta)) {
    throw new ApiError(
      `Insufficient balance\nAvailable: ₹${Number(account.currentBalance || 0).toLocaleString("en-IN")}\nRequired: ₹${Math.abs(delta).toLocaleString("en-IN")}`,
      400,
      { code: "INSUFFICIENT_BALANCE", available: Number(account.currentBalance || 0), required: Math.abs(delta), actions: ["Add Money", "Change Account", "Transfer Funds"] }
    );
  }
  const updated = await Account.findOneAndUpdate(
    { _id: accountId, userId },
    { $inc: { currentBalance: delta } },
    { new: true, session }
  );
  if (!updated) throw new ApiError("Account balance update failed", 404);
  await AccountLedgerEntry.create([{
    userId,
    account: accountId,
    ...(transaction ? { transaction: transaction._id, requestKey: transaction.requestKey } : {}),
    ...(settlement ? { settlement: settlement._id, requestKey: settlement.requestKey } : {}),
    delta,
    balanceAfter: Number(updated.currentBalance),
    operation,
    createdBy: userId,
    metadata: transaction
      ? { transactionType: transaction.type, transactionVersion: transaction.version || 0 }
      : { settlementDirection: settlement?.direction }
  }], { session });
  return updated;
}
