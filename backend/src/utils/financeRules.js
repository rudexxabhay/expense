export const INCOME_TYPES = ["INCOME"];
export const PERSONAL_EXPENSE_TYPES = ["EXPENSE", "PAID_BY_SOMEONE", "SPLIT_EXPENSE"];
export const RECEIVABLE_TYPES = ["LEND", "PAID_FOR_SOMEONE"];
export const PAYABLE_TYPES = ["BORROW", "PAID_BY_SOMEONE"];
export const SETTLEMENT_TYPES = ["REPAYMENT_RECEIVED", "REPAYMENT_PAID"];
export const TRANSFER_TYPES = ["TRANSFER"];
export const LOAN_TYPES = [...RECEIVABLE_TYPES, ...PAYABLE_TYPES];
export const OPEN_REPAYMENT_STATUSES = ["PENDING", "PARTIAL"];

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

export function dueDateMatch(due, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (due === "TODAY") return { $gte: today, $lt: tomorrow };
  if (due === "UPCOMING") return { $gte: tomorrow };
  if (due === "OVERDUE") return { $lt: today };
  return null;
}

export function personalExpenseAmountExpression() {
  return { $ifNull: ["$myShare", "$amount"] };
}

export function dueBucketExpression(today, tomorrow) {
  return {
    $switch: {
      branches: [
        { case: { $lt: ["$dueDate", today] }, then: "OVERDUE" },
        { case: { $lt: ["$dueDate", tomorrow] }, then: "TODAY" }
      ],
      default: "UPCOMING"
    }
  };
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
