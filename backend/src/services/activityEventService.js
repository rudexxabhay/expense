import ActivityEvent from "../models/ActivityEvent.js";
import Transaction from "../models/Transaction.js";
import Obligation from "../models/Obligation.js";
import ObligationEvent from "../models/ObligationEvent.js";
import Settlement from "../models/Settlement.js";
import SettlementAllocation from "../models/SettlementAllocation.js";

function eventDate(date, time) {
  const parsed = date ? new Date(date) : new Date();
  if (time) {
    const [hour, minute] = String(time).split(":").map(Number);
    parsed.setHours(hour || 0, minute || 0, 0, 0);
  }
  return parsed;
}

function transactionLabel(transaction) {
  return ({
    EXPENSE: "Expense",
    INCOME: "Income",
    BORROW: "Loan Taken",
    LEND: "Lent Money",
    PAID_FOR_SOMEONE: "Paid for Someone",
    PAID_BY_SOMEONE: "Paid for Me",
    REPAYMENT_RECEIVED: "Payment Received",
    REPAYMENT_PAID: "Payment Made",
    TRANSFER: "Transfer",
    SPLIT_EXPENSE: "Split Expense",
    BALANCE_ADJUSTMENT: "Balance Adjustment"
  })[transaction.type] || transaction.type;
}

function transactionDirection(transaction) {
  if (["INCOME", "BORROW", "REPAYMENT_RECEIVED"].includes(transaction.type)) return "IN";
  if (["EXPENSE", "LEND", "PAID_FOR_SOMEONE", "SPLIT_EXPENSE", "REPAYMENT_PAID"].includes(transaction.type)) return "OUT";
  if (transaction.type === "TRANSFER") return "NEUTRAL";
  if (transaction.type === "PAID_BY_SOMEONE") return "PAYABLE";
  return "NEUTRAL";
}

function transactionTitle(transaction) {
  if (transaction.type === "BORROW") return "Loan taken";
  if (transaction.type === "LEND") return "Lent money";
  if (transaction.type === "PAID_FOR_SOMEONE") return "Paid for someone";
  if (transaction.type === "PAID_BY_SOMEONE") return "Someone paid for me";
  if (transaction.type === "SPLIT_EXPENSE") return "Split expense";
  if (transaction.type === "TRANSFER") return "Account transfer";
  return transaction.note || transactionLabel(transaction);
}

async function insertActivityEvent(payload, session) {
  const options = session ? { upsert: true, session } : { upsert: true };
  await ActivityEvent.updateOne(
    { userId: payload.userId, eventKey: payload.eventKey },
    { $setOnInsert: payload },
    options
  );
}

export async function recordTransactionCreatedActivity({ transaction, obligation, userId, session }) {
  await insertActivityEvent({
    userId,
    eventKey: `transaction:${transaction._id}:created`,
    eventType: "TRANSACTION_CREATED",
    systemLabel: transactionLabel(transaction),
    rootTransaction: transaction.parentTransaction || transaction._id,
    transaction: transaction._id,
    obligation: obligation?._id,
    person: transaction.person,
    account: transaction.account,
    category: transaction.category,
    tags: transaction.tags || [],
    amount: Number(transaction.myShare ?? transaction.amount),
    direction: obligation?.direction || transactionDirection(transaction),
    title: transactionTitle(transaction),
    subtitle: transaction.note || "",
    note: transaction.note || "",
    occurredAt: eventDate(transaction.transactionDate, transaction.transactionTime),
    originalAmount: obligation?.originalAmount ?? transaction.originalAmount ?? transaction.amount,
    totalSettledAfter: obligation?.settledAmount,
    remainingAfter: obligation?.remainingAmount,
    statusAfter: obligation?.status || transaction.status,
    metadata: {
      transactionType: transaction.type,
      sourceType: obligation?.sourceType,
      destinationAccount: transaction.destinationAccount,
      splitGroupId: transaction.splitGroupId,
      parentTransaction: transaction.parentTransaction
    },
    createdBy: transaction.createdBy || userId
  }, session);
}

export async function recordTransactionAuditActivity({ transaction, audit, action, userId, session }) {
  await insertActivityEvent({
    userId,
    eventKey: `transaction:${transaction._id}:${action.toLowerCase()}:${audit.version}`,
    eventType: action === "CANCELLED" ? "TRANSACTION_CANCELLED" : "TRANSACTION_UPDATED",
    systemLabel: action === "CANCELLED" ? "Reversed" : "Correction",
    rootTransaction: transaction.parentTransaction || transaction._id,
    transaction: transaction._id,
    person: transaction.person,
    account: transaction.account,
    category: transaction.category,
    tags: transaction.tags || [],
    amount: Number(transaction.myShare ?? transaction.amount),
    direction: transactionDirection(transaction),
    title: action === "CANCELLED" ? "Transaction cancelled" : "Transaction updated",
    subtitle: transaction.note || "",
    note: transaction.note || "",
    occurredAt: audit.createdAt || new Date(),
    statusBefore: audit.before?.status,
    statusAfter: transaction.status,
    metadata: { before: audit.before, after: audit.after, version: audit.version },
    createdBy: userId
  }, session);
}

export async function recordSettlementActivity({ obligation, settlement, allocation, statusBefore, remainingBefore, userId, session }) {
  const paid = obligation.direction === "PAYABLE";
  const amount = Number(allocation.amount || 0);
  await insertActivityEvent({
    userId,
    eventKey: `settlement:${settlement._id}:allocation:${allocation._id}`,
    eventType: "SETTLEMENT_ALLOCATED",
    systemLabel: paid ? "Loan Repayment" : "Payment Received",
    rootTransaction: obligation.sourceTransaction,
    obligation: obligation._id,
    settlement: settlement._id,
    allocation: allocation._id,
    person: obligation.person,
    account: settlement.account,
    amount,
    direction: paid ? "OUT" : "IN",
    title: paid ? "Payment made" : "Payment received",
    subtitle: "Against exact obligation",
    note: settlement.note || "",
    occurredAt: eventDate(settlement.settlementDate, settlement.settlementTime),
    originalAmount: Number(obligation.originalAmount || 0),
    amountSettledThisEvent: amount,
    totalSettledBefore: Number(obligation.settledAmount || 0) - amount,
    totalSettledAfter: Number(obligation.settledAmount || 0),
    remainingBefore,
    remainingAfter: Number(obligation.remainingAmount || 0),
    statusBefore,
    statusAfter: obligation.status,
    metadata: {
      sourceType: obligation.sourceType,
      settlementDirection: settlement.direction,
      requestKey: settlement.requestKey
    },
    createdBy: settlement.createdBy || userId
  }, session);
}

export async function recordSettlementReversalActivity({ obligation, settlement, allocation, statusBefore, remainingBefore, userId, session }) {
  await insertActivityEvent({
    userId,
    eventKey: `settlement:${settlement._id}:allocation:${allocation._id}:reversed:${settlement.version}`,
    eventType: "SETTLEMENT_REVERSED",
    systemLabel: "Reversed",
    rootTransaction: obligation.sourceTransaction,
    obligation: obligation._id,
    settlement: settlement._id,
    allocation: allocation._id,
    person: obligation.person,
    account: settlement.account,
    amount: Number(allocation.amount || 0),
    direction: obligation.direction,
    title: "Settlement reversed",
    subtitle: "History preserved",
    note: settlement.note || "",
    occurredAt: new Date(),
    originalAmount: Number(obligation.originalAmount || 0),
    amountSettledThisEvent: Number(allocation.amount || 0),
    totalSettledAfter: Number(obligation.settledAmount || 0),
    remainingBefore,
    remainingAfter: Number(obligation.remainingAmount || 0),
    statusBefore,
    statusAfter: obligation.status,
    metadata: { sourceType: obligation.sourceType },
    createdBy: userId
  }, session);
}

export async function recordObligationStatusActivity({ obligation, statusBefore, statusAfter, remainingBefore, remainingAfter, userId, session, reason = "status transition" }) {
  await insertActivityEvent({
    userId,
    eventKey: `obligation:${obligation._id}:status:${obligation.version}:${statusAfter}`,
    eventType: "OBLIGATION_STATUS_CHANGED",
    systemLabel: statusAfter === "OVERDUE" ? "Overdue" : statusAfter === "SETTLED" ? "Settled" : "Status Updated",
    rootTransaction: obligation.sourceTransaction,
    obligation: obligation._id,
    person: obligation.person,
    amount: Number(obligation.remainingAmount || 0),
    direction: obligation.direction,
    title: "Obligation status updated",
    subtitle: reason,
    occurredAt: new Date(),
    originalAmount: Number(obligation.originalAmount || 0),
    totalSettledAfter: Number(obligation.settledAmount || 0),
    remainingBefore,
    remainingAfter,
    statusBefore,
    statusAfter,
    metadata: { sourceType: obligation.sourceType, reason },
    createdBy: userId
  }, session);
}

function settlementEventTitle(event, obligation) {
  if (event.eventType === "SETTLEMENT_REVERSED") return "Settlement reversed";
  return obligation.direction === "PAYABLE" ? "Payment made" : "Payment received";
}

function settlementEventLabel(event, obligation) {
  if (event.eventType === "SETTLEMENT_REVERSED") return "Reversed";
  return obligation.direction === "PAYABLE" ? "Loan Repayment" : "Payment Received";
}

export async function ensureActivityEventsForUser(userId) {
  const [transactions, obligations, obligationEvents] = await Promise.all([
    Transaction.find({ userId }).sort({ createdAt: 1 }),
    Obligation.find({ userId }).sort({ createdAt: 1 }),
    ObligationEvent.find({ userId }).sort({ createdAt: 1 })
  ]);
  const obligationBySource = obligations.reduce((map, obligation) => map.set(String(obligation.sourceTransaction), obligation), new Map());
  const obligationById = obligations.reduce((map, obligation) => map.set(String(obligation._id), obligation), new Map());

  for (const transaction of transactions) {
    await recordTransactionCreatedActivity({
      transaction,
      obligation: obligationBySource.get(String(transaction._id)),
      userId
    });
  }

  const settlementIds = obligationEvents.map((event) => event.settlement).filter(Boolean);
  const allocationIds = obligationEvents.map((event) => event.allocation).filter(Boolean);
  const [settlements, allocations] = await Promise.all([
    Settlement.find({ userId, _id: { $in: settlementIds } }),
    SettlementAllocation.find({ userId, _id: { $in: allocationIds } })
  ]);
  const settlementById = settlements.reduce((map, settlement) => map.set(String(settlement._id), settlement), new Map());
  const allocationById = allocations.reduce((map, allocation) => map.set(String(allocation._id), allocation), new Map());

  for (const event of obligationEvents) {
    const obligation = obligationById.get(String(event.obligation));
    if (!obligation) continue;
    if (event.eventType === "CREATED") continue;
    if (event.eventType === "SETTLEMENT_ALLOCATED" || event.eventType === "SETTLEMENT_REVERSED") {
      const settlement = event.settlement ? settlementById.get(String(event.settlement)) : null;
      const allocation = event.allocation ? allocationById.get(String(event.allocation)) : null;
      if (!settlement || !allocation) continue;
      const amount = Number(event.amount || allocation.amount || 0);
      const remainingBefore = Number(event.remainingBefore ?? obligation.originalAmount);
      const remainingAfter = Number(event.remainingAfter ?? Math.max(0, remainingBefore - amount));
      await insertActivityEvent({
        userId,
        eventKey: event.eventType === "SETTLEMENT_REVERSED"
          ? `settlement:${settlement._id}:allocation:${allocation._id}:reversed:${event._id}`
          : `settlement:${settlement._id}:allocation:${allocation._id}`,
        eventType: event.eventType,
        systemLabel: settlementEventLabel(event, obligation),
        rootTransaction: obligation.sourceTransaction,
        obligation: obligation._id,
        settlement: settlement._id,
        allocation: allocation._id,
        person: obligation.person,
        account: settlement.account,
        amount,
        direction: event.eventType === "SETTLEMENT_REVERSED" ? obligation.direction : obligation.direction === "PAYABLE" ? "OUT" : "IN",
        title: settlementEventTitle(event, obligation),
        subtitle: "Against exact obligation",
        note: settlement.note || "",
        occurredAt: event.createdAt || eventDate(settlement.settlementDate, settlement.settlementTime),
        originalAmount: Number(obligation.originalAmount || 0),
        amountSettledThisEvent: amount,
        totalSettledBefore: Number(obligation.originalAmount || 0) - remainingBefore,
        totalSettledAfter: Number(obligation.originalAmount || 0) - remainingAfter,
        remainingBefore,
        remainingAfter,
        statusBefore: event.statusBefore,
        statusAfter: event.statusAfter,
        metadata: { sourceType: obligation.sourceType, backfilled: true },
        createdBy: event.createdBy || userId
      });
      continue;
    }
    await insertActivityEvent({
      userId,
      eventKey: `obligation:${obligation._id}:event:${event._id}`,
      eventType: "OBLIGATION_STATUS_CHANGED",
      systemLabel: event.statusAfter === "OVERDUE" ? "Overdue" : "Status Updated",
      rootTransaction: obligation.sourceTransaction,
      obligation: obligation._id,
      person: obligation.person,
      amount: Number(event.remainingAfter ?? obligation.remainingAmount ?? 0),
      direction: obligation.direction,
      title: "Obligation status updated",
      subtitle: event.metadata?.reason || "status transition",
      occurredAt: event.createdAt || new Date(),
      originalAmount: Number(obligation.originalAmount || 0),
      remainingBefore: event.remainingBefore,
      remainingAfter: event.remainingAfter,
      statusBefore: event.statusBefore,
      statusAfter: event.statusAfter,
      metadata: { sourceType: obligation.sourceType, backfilled: true, ...event.metadata },
      createdBy: event.createdBy || userId
    });
  }
}
