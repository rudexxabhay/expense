export const INCOME_TYPES = ["INCOME"];
export const PERSONAL_EXPENSE_TYPES = ["EXPENSE", "PAID_BY_SOMEONE", "SPLIT_EXPENSE"];
export const RECEIVABLE_TYPES = ["LEND", "PAID_FOR_SOMEONE"];
export const PAYABLE_TYPES = ["BORROW", "PAID_BY_SOMEONE"];
export const SETTLEMENT_TYPES = ["REPAYMENT_RECEIVED", "REPAYMENT_PAID"];
export const TRANSFER_TYPES = ["TRANSFER"];
export const LOAN_TYPES = [...RECEIVABLE_TYPES, ...PAYABLE_TYPES];
export const OPEN_REPAYMENT_STATUSES = ["PENDING", "PARTIAL"];
export const DEFAULT_FINANCE_TIME_ZONE = "Asia/Kolkata";

export function normalizeFinanceTimeZone(timeZone = DEFAULT_FINANCE_TIME_ZONE) {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return DEFAULT_FINANCE_TIME_ZONE;
  }
}

function localCalendarDateKey(value, timeZone = DEFAULT_FINANCE_TIME_ZONE, preserveDateOnly = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // Date-only values are stored at UTC midnight; preserve their entered calendar day.
  const dateOnly = preserveDateOnly && date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: dateOnly ? "UTC" : normalizeFinanceTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function classifyObligation(obligation = {}, now = new Date(), timeZone = DEFAULT_FINANCE_TIME_ZONE) {
  const remainingAmount = Number(obligation.remainingAmount || 0);
  const settledAmount = Number(obligation.settledAmount || 0);
  const cancelled = obligation.cancelled === true || obligation.status === "CANCELLED";
  const settled = !cancelled && (remainingAmount <= 0 || obligation.status === "SETTLED");
  const partial = !cancelled && !settled && (settledAmount > 0 || ["PARTIAL", "PARTIALLY_SETTLED"].includes(obligation.status));
  const dateState = classifyDateState(obligation.dueDate, now, timeZone);
  const settlementState = cancelled ? "CANCELLED" : settled ? "SETTLED" : partial ? "PARTIAL" : "OPEN";
  return { dateState, settlementState };
}

export function classifyDateState(dueDate, now = new Date(), timeZone = DEFAULT_FINANCE_TIME_ZONE) {
  const dueKey = localCalendarDateKey(dueDate, timeZone, true);
  const todayKey = localCalendarDateKey(now, timeZone);
  return !dueKey ? "NO_DATE" : dueKey < todayKey ? "OVERDUE" : dueKey > todayKey ? "UPCOMING" : "TODAY";
}

export function obligationDateStateExpression(timeZone = DEFAULT_FINANCE_TIME_ZONE) {
  const zone = normalizeFinanceTimeZone(timeZone);
  const dateOnly = { $eq: [{ $dateToString: { date: "$dueDate", format: "%H%M%S%L", timezone: "UTC" } }, "000000000"] };
  const dueKey = {
    $cond: [dateOnly,
      { $dateToString: { date: "$dueDate", format: "%Y-%m-%d", timezone: "UTC" } },
      { $dateToString: { date: "$dueDate", format: "%Y-%m-%d", timezone: zone } }
    ]
  };
  const todayKey = { $dateToString: { date: "$$NOW", format: "%Y-%m-%d", timezone: zone } };
  return {
    $switch: {
      branches: [
        { case: { $eq: [{ $ifNull: ["$dueDate", null] }, null] }, then: "NO_DATE" },
        { case: { $lt: [dueKey, todayKey] }, then: "OVERDUE" },
        { case: { $gt: [dueKey, todayKey] }, then: "UPCOMING" }
      ],
      default: "TODAY"
    }
  };
}

export function accountBalanceDeltas(transaction, multiplier = 1) {
  const amount = Number(transaction.amount || 0);
  switch (transaction.type) {
    case "EXPENSE":
    case "LEND":
    case "PAID_FOR_SOMEONE":
    case "SPLIT_EXPENSE":
    case "REPAYMENT_PAID":
      return [{ accountId: transaction.account, delta: -amount * multiplier }];
    case "INCOME":
    case "BORROW":
    case "REPAYMENT_RECEIVED":
      return [{ accountId: transaction.account, delta: amount * multiplier }];
    case "BALANCE_ADJUSTMENT":
      return [{
        accountId: transaction.account,
        delta: amount * (transaction.adjustmentDirection === "INCREASE" ? 1 : -1) * multiplier
      }];
    case "TRANSFER":
      return [
        { accountId: transaction.account, delta: -amount * multiplier },
        { accountId: transaction.destinationAccount, delta: amount * multiplier }
      ];
    case "PAID_BY_SOMEONE":
    default:
      return [];
  }
}

export function personalExpenseValue(typeTotals = {}) {
  return Number(typeTotals.EXPENSE?.personalAmount || 0)
    + Number(typeTotals.PAID_BY_SOMEONE?.personalAmount || 0)
    + Number(typeTotals.SPLIT_EXPENSE?.personalAmount || 0);
}

export function personalExpenseAmount(transaction = {}) {
  return countsAsPersonalExpense(transaction.type)
    ? Number(transaction.myShare ?? transaction.amount ?? 0)
    : 0;
}

export function incomeValue(typeTotals = {}) {
  return Number(typeTotals.INCOME?.total || 0);
}

export function summarizeOutstandingByType(rows = []) {
  const byType = rows.reduce((totals, row) => {
    totals[row._id] = Number(row.total || 0);
    return totals;
  }, {});
  const lentOutstanding = byType.LEND || 0;
  const paidForSomeoneOutstanding = (byType.PAID_FOR_SOMEONE || 0) + (byType.SPLIT_SHARE || 0);
  const borrowedOutstanding = byType.BORROW || 0;
  const someonePaidForMeOutstanding = byType.PAID_BY_SOMEONE || 0;
  return {
    lentOutstanding,
    paidForSomeoneOutstanding,
    borrowedOutstanding,
    someonePaidForMeOutstanding,
    totalToReceive: lentOutstanding + paidForSomeoneOutstanding,
    totalToPay: borrowedOutstanding + someonePaidForMeOutstanding
  };
}

export function outstandingTransactionMatch(userId, extra = {}) {
  return {
    userId,
    status: "ACTIVE",
    type: { $in: [...RECEIVABLE_TYPES, ...PAYABLE_TYPES] },
    repaymentStatus: { $in: OPEN_REPAYMENT_STATUSES },
    remainingAmount: { $gt: 0 },
    ...extra
  };
}

export function directionTypes(direction) {
  if (direction === "PAYABLE") return PAYABLE_TYPES;
  if (direction === "RECEIVABLE") return RECEIVABLE_TYPES;
  return [];
}

export function dueDateMatch(due, timeZone = DEFAULT_FINANCE_TIME_ZONE) {
  if (!["TODAY", "UPCOMING", "OVERDUE"].includes(due)) return null;
  return { $expr: { $eq: [obligationDateStateExpression(timeZone), due] } };
}

export function personalExpenseAmountExpression() {
  return { $ifNull: ["$myShare", "$amount"] };
}

export function countsAsIncome(type) {
  return INCOME_TYPES.includes(type);
}

export function countsAsPersonalExpense(type) {
  return PERSONAL_EXPENSE_TYPES.includes(type);
}

export function affectsIncomeExpense(type) {
  return countsAsIncome(type) || countsAsPersonalExpense(type);
}

export function isReceivable(type) {
  return RECEIVABLE_TYPES.includes(type);
}

export function isPayable(type) {
  return PAYABLE_TYPES.includes(type);
}

export function isSettlement(type) {
  return SETTLEMENT_TYPES.includes(type);
}

export function isTransfer(type) {
  return TRANSFER_TYPES.includes(type);
}
