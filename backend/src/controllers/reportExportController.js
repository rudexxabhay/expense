import mongoose from "mongoose";
import Account from "../models/Account.js";
import Category from "../models/Category.js";
import Person from "../models/Person.js";
import Tag from "../models/Tag.js";
import Transaction from "../models/Transaction.js";
import Obligation from "../models/Obligation.js";
import SettlementAllocation from "../models/SettlementAllocation.js";
import Settlement from "../models/Settlement.js";
import ActivityEvent from "../models/ActivityEvent.js";
import { ensureUserObligations, refreshUserObligationStatuses } from "../services/obligationService.js";
import { ensureActivityEventsForUser } from "../services/activityEventService.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { createPdf, createXlsx } from "../utils/reportFiles.js";
import {
  OPEN_REPAYMENT_STATUSES,
  LOAN_TYPES,
  PAYABLE_TYPES,
  RECEIVABLE_TYPES,
  SETTLEMENT_TYPES,
  countsAsIncome,
  directionTypes,
  dueDateMatch,
  isPayable,
  isReceivable,
  personalExpenseAmount,
  summarizeOutstandingByType
} from "../utils/financeRules.js";

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endExclusive(date) {
  const next = startOfDay(date);
  next.setDate(next.getDate() + 1);
  return next;
}

function resolveDateRange(query = {}) {
  const now = new Date();
  let start;
  let end;
  if (query.startDate || query.endDate) {
    start = query.startDate ? startOfDay(new Date(query.startDate)) : undefined;
    end = query.endDate ? endExclusive(new Date(query.endDate)) : query.startDate ? endExclusive(now) : undefined;
  } else if (query.period === "today") {
    start = startOfDay(now);
    end = endExclusive(now);
  } else if (query.period === "this_week") {
    start = startOfDay(now);
    start.setDate(now.getDate() - now.getDay());
    end = endExclusive(now);
  } else if (query.period === "this_month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  } else if (query.period === "last_month") {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (query.month && query.year) {
    start = new Date(Number(query.year), Number(query.month) - 1, 1);
    end = new Date(Number(query.year), Number(query.month), 1);
  } else if (query.year) {
    start = new Date(Number(query.year), 0, 1);
    end = new Date(Number(query.year) + 1, 0, 1);
  }
  if (!start && !end) return null;
  return { ...(start ? { $gte: start } : {}), ...(end ? { $lt: end } : {}) };
}

function buildFilters(query, userId) {
  const filters = { userId };
  ["type", "account", "person", "category", "status"].forEach((field) => {
    if (query[field]) filters[field] = query[field];
  });
  if (query.tag) filters.tags = query.tag;
  const dateRange = resolveDateRange(query);
  if (dateRange) filters.transactionDate = dateRange;
  if (query.direction || query.due) {
    const direction = String(query.direction || "").toUpperCase();
    const due = String(query.due || "").toUpperCase();
    if (!["PAYABLE", "RECEIVABLE"].includes(direction) || !["TODAY", "UPCOMING", "OVERDUE"].includes(due)) {
      throw new ApiError("Valid direction and due filters are required", 400);
    }
    const allowedTypes = directionTypes(direction);
    filters.type = query.type
      ? (allowedTypes.includes(query.type) ? query.type : { $in: [] })
      : { $in: allowedTypes };
    filters.status = "ACTIVE";
    filters.repaymentStatus = { $in: OPEN_REPAYMENT_STATUSES };
    filters.remainingAmount = { $gt: 0 };
    delete filters.transactionDate;
    filters.dueDate = dueDateMatch(due);
  }
  if (query.balanceStatus === "pending") {
    filters.repaymentStatus = { $in: OPEN_REPAYMENT_STATUSES };
    filters.remainingAmount = { $gt: 0 };
  }
  if (query.balanceStatus === "settled") {
    filters.$or = [{ repaymentStatus: "PAID" }, { remainingAmount: { $lte: 0 } }];
  }
  if (["overdue_payable", "overdue_receivable"].includes(query.balanceStatus)) {
    filters.repaymentStatus = { $in: OPEN_REPAYMENT_STATUSES };
    filters.remainingAmount = { $gt: 0 };
    filters.dueDate = { $lt: startOfDay(new Date()) };
    filters.type = { $in: query.balanceStatus === "overdue_payable" ? PAYABLE_TYPES : RECEIVABLE_TYPES };
    filters.status = "ACTIVE";
    delete filters.transactionDate;
  } else if (query.balanceStatus === "overdue") {
    throw new ApiError("Choose payable or receivable for overdue filters", 400);
  }
  return filters;
}

function sortOption(sort = "newest") {
  return {
    newest: { transactionDate: -1, transactionTime: -1, createdAt: -1 },
    oldest: { transactionDate: 1, transactionTime: 1, createdAt: 1 },
    due_soon: { dueDate: 1, transactionDate: -1 },
    amount_high: { amount: -1, transactionDate: -1 },
    amount_low: { amount: 1, transactionDate: -1 }
  }[sort] || { transactionDate: -1, transactionTime: -1, createdAt: -1 };
}

function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function dateText(value) {
  return value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

function transactionRows(transactions) {
  return transactions.map((item) => [
    dateText(item.transactionDate),
    item.transactionTime || "",
    item.type,
    item.person?.name || "",
    item.account?.name || "",
    item.category?.name || "",
    item.tags?.map((tag) => tag.name).join(", ") || "",
    Number(item.amount || 0),
    LOAN_TYPES.includes(item.type)
      ? Number(item.remainingAmount ?? item.amount ?? 0)
      : "",
    item.status || "",
    dateText(item.dueDate),
    item.note || ""
  ]);
}

function activityDateText(value) {
  return value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

function activityTimeText(value) {
  return value ? new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
}

async function buildActivityReportFilters(query, userId, transactionFilters) {
  const filters = { userId };
  if (transactionFilters.transactionDate) filters.occurredAt = transactionFilters.transactionDate;
  if (query.person) filters.person = query.person;
  if (query.account) filters.account = query.account;
  if (query.category) filters.category = query.category;
  if (query.tag) filters.tags = query.tag;
  if (query.status) filters.statusAfter = query.status;
  if (query.direction) filters.direction = String(query.direction).toUpperCase();
  if (query.type) {
    filters.$or = [
      { eventType: query.type },
      { systemLabel: { $regex: String(query.type).replaceAll("_", " "), $options: "i" } },
      { "metadata.transactionType": query.type },
      { "metadata.sourceType": query.type }
    ];
  }
  if (query.q) {
    const text = String(query.q).trim();
    const amount = Number(text);
    const idMatch = mongoose.Types.ObjectId.isValid(text) ? new mongoose.Types.ObjectId(text) : null;
    const [people, categories, tags] = await Promise.all([
      Person.find({ userId, name: { $regex: text, $options: "i" } }).select("_id").limit(50),
      Category.find({ userId, name: { $regex: text, $options: "i" } }).select("_id").limit(50),
      Tag.find({ userId, name: { $regex: text, $options: "i" } }).select("_id").limit(50)
    ]);
    filters.$and = [
      ...(filters.$and || []),
      {
        $or: [
          { title: { $regex: text, $options: "i" } },
          { subtitle: { $regex: text, $options: "i" } },
          { note: { $regex: text, $options: "i" } },
          { systemLabel: { $regex: text, $options: "i" } },
          ...(people.length ? [{ person: { $in: people.map((item) => item._id) } }] : []),
          ...(categories.length ? [{ category: { $in: categories.map((item) => item._id) } }] : []),
          ...(tags.length ? [{ tags: { $in: tags.map((item) => item._id) } }] : []),
          ...(Number.isFinite(amount) ? [{ amount }] : []),
          ...(idMatch ? [{ transaction: idMatch }, { rootTransaction: idMatch }, { obligation: idMatch }, { settlement: idMatch }] : [])
        ]
      }
    ];
  }
  return filters;
}

function activityRows(events) {
  return events.map((event) => [
    activityDateText(event.occurredAt),
    activityTimeText(event.occurredAt),
    event.systemLabel || event.eventType,
    event.metadata?.transactionType || event.metadata?.sourceType || event.rootTransaction?.type || event.transaction?.type || "",
    event.person?.name || "",
    event.account?.name || "",
    Number(event.amount || 0),
    String(event.rootTransaction?._id || event.rootTransaction || ""),
    String(event.obligation?._id || event.obligation || ""),
    String(event.settlement?._id || event.settlement || ""),
    Number(event.originalAmount || 0),
    event.remainingBefore === undefined || event.remainingBefore === null ? "" : Number(event.remainingBefore),
    event.remainingAfter === undefined || event.remainingAfter === null ? "" : Number(event.remainingAfter),
    event.statusAfter || "",
    event.note || event.subtitle || ""
  ]);
}

function totals(transactions) {
  return transactions.reduce((acc, item) => {
    const amount = Number(item.amount || 0);
    if (countsAsIncome(item.type)) acc.income += amount;
    acc.expense += personalExpenseAmount(item);
    if (isReceivable(item.type) && item.repaymentStatus !== "PAID") acc.toReceive += Number(item.remainingAmount || 0);
    if (isPayable(item.type) && item.repaymentStatus !== "PAID") acc.toPay += Number(item.remainingAmount || 0);
    if (item.type === "BORROW") acc.borrowed += amount;
    if (RECEIVABLE_TYPES.includes(item.type)) acc.lent += amount;
    if (SETTLEMENT_TYPES.includes(item.type)) acc.settlements += amount;
    if (item.type === "REPAYMENT_RECEIVED") acc.receivedBack += amount;
    if (item.type === "REPAYMENT_PAID") acc.paidBack += amount;
    return acc;
  }, { income: 0, expense: 0, toReceive: 0, toPay: 0, borrowed: 0, lent: 0, settlements: 0, receivedBack: 0, paidBack: 0, savings: 0 });
}

function filterLines(query) {
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      const display = key === "direction"
        ? (String(value).toUpperCase() === "PAYABLE" ? "Payments" : "Receivables")
        : key === "due"
          ? ({ TODAY: "Today", UPCOMING: "Upcoming", OVERDUE: "Overdue" }[String(value).toUpperCase()] || value)
          : value;
      return `${key}: ${display}`;
    });
}

function filename(query, extension) {
  const month = query.month && query.year
    ? new Date(Number(query.year), Number(query.month) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }).replace(/\s+/g, "_")
    : new Date().toISOString().slice(0, 10);
  return `Expense_Report_${month}.${extension}`;
}

async function reportData(req) {
  await ensureUserObligations(req.userId);
  await refreshUserObligationStatuses(req.userId);
  await ensureActivityEventsForUser(req.userId);
  const filters = buildFilters(req.query, req.userId);
  if (!filters.status) filters.status = "ACTIVE";
  const [transactions, outstanding] = await Promise.all([
    Transaction.find(filters)
    .sort(sortOption(req.query.sort))
    .populate("account", "name type currentBalance")
    .populate("destinationAccount", "name")
    .populate("person", "name")
    .populate("category", "name")
    .populate("tags", "name"),
    Obligation.aggregate([
      {
        $match: {
          userId: req.userId,
          status: { $nin: ["SETTLED", "CANCELLED"] },
          remainingAmount: { $gt: 0 }
        }
      },
      { $group: { _id: "$sourceType", total: { $sum: "$remainingAmount" } } }
    ])
  ]);
  const totalRows = totals(transactions);
  const outstandingTotals = summarizeOutstandingByType(outstanding);
  Object.assign(totalRows, outstandingTotals, {
    toReceive: outstandingTotals.totalToReceive,
    toPay: outstandingTotals.totalToPay
  });
  const settlementDateRange = filters.transactionDate;
  const settlementTotals = await Settlement.aggregate([
    { $match: {
      userId: req.userId,
      status: "ACTIVE",
      ...(settlementDateRange ? { settlementDate: settlementDateRange } : {}),
      ...(filters.person ? { person: filters.person } : {}),
      ...(filters.account ? { account: filters.account } : {})
    } },
    { $group: { _id: "$direction", total: { $sum: { $ifNull: ["$totalAmount", "$amount"] } } } }
  ]);
  totalRows.receivedBack = settlementTotals.filter((item) => ["RECEIPT", "RECEIVED_BY_ME"].includes(item._id)).reduce((sum, item) => sum + item.total, 0);
  totalRows.paidBack = settlementTotals.filter((item) => ["PAYMENT", "PAID_BY_ME"].includes(item._id)).reduce((sum, item) => sum + item.total, 0);
  totalRows.settlements = totalRows.receivedBack + totalRows.paidBack;
  totalRows.savings = totalRows.income - totalRows.expense;
  const [people, accounts] = await Promise.all([
    Person.find({ userId: req.userId, isActive: true }).sort({ name: 1 }),
    Account.find({ userId: req.userId, isActive: true }).sort({ name: 1 })
  ]);
  const obligations = await Obligation.find({ userId: req.userId }).populate("person", "name").populate("sourceTransaction", "type transactionDate").sort({ createdAt: -1 });
  const allocations = await SettlementAllocation.find({ userId: req.userId, obligation: { $in: obligations.map((item) => item._id) } })
    .populate({ path: "settlement", match: { userId: req.userId }, populate: { path: "account", select: "name" } });
  const allocationsByObligation = allocations.reduce((map, item) => {
    if (item.settlement) map.set(String(item.obligation), [...(map.get(String(item.obligation)) || []), item]);
    return map;
  }, new Map());
  const obligationRows = obligations.flatMap((item) => {
    const linked = allocationsByObligation.get(String(item._id)) || [];
    const history = linked.length ? linked : [null];
    return history.map((allocation) => [
      String(item._id),
      String(item.sourceTransaction?._id || item.sourceTransaction || ""),
      item.person?.name || "",
      item.sourceType,
      item.direction,
      Number(item.originalAmount || 0),
      Number(item.settledAmount || 0),
      Number(item.remainingAmount || 0),
      item.status,
      dateText(item.dueDate),
      dateText(allocation?.settlement?.settlementDate),
      allocation?.settlement?.account?.name || "",
      Number(allocation?.amount || 0)
    ]);
  });
  const activityFilters = await buildActivityReportFilters(req.query, req.userId, filters);
  const activityEvents = await ActivityEvent.find(activityFilters)
    .sort({ occurredAt: -1, createdAt: -1 })
    .populate("person", "name")
    .populate("account", "name")
    .populate("rootTransaction", "type amount transactionDate")
    .populate("transaction", "type amount transactionDate")
    .populate("obligation", "sourceType direction originalAmount remainingAmount status")
    .populate("settlement", "direction amount totalAmount settlementDate")
    .limit(1000);
  return { transactions, totals: totalRows, people, accounts, obligationRows, activityRows: activityRows(activityEvents) };
}

export const exportPdfReport = asyncHandler(async (req, res) => {
  const data = await reportData(req);
  const summaryRows = [
    ["Total Income", money(data.totals.income)],
    ["Total Expense", money(data.totals.expense)],
    ["To Receive", money(data.totals.toReceive)],
    ["To Pay", money(data.totals.toPay)],
    ["Lent Outstanding", money(data.totals.lentOutstanding)],
    ["Paid for Someone Outstanding", money(data.totals.paidForSomeoneOutstanding)],
    ["Borrowed Outstanding", money(data.totals.borrowedOutstanding)],
    ["Someone Paid for Me Outstanding", money(data.totals.someonePaidForMeOutstanding)],
    ["Borrowed", money(data.totals.borrowed)],
    ["Lent", money(data.totals.lent)],
    ["Settlements", money(data.totals.settlements)],
    ["Received Back", money(data.totals.receivedBack)],
    ["Paid Back", money(data.totals.paidBack)],
    ["Savings", money(data.totals.savings)]
  ];
  const pdf = createPdf({
    title: "Expense Report",
    metaLines: [
      `User: ${req.user.name}`,
      `Generated: ${new Date().toLocaleString("en-IN")}`,
      `Filters: ${filterLines(req.query).join(" · ") || "Full report"}`
    ],
    summaryRows,
    tableHeaders: ["Date", "Time", "Type", "Person", "Account", "Category", "Tags", "Amount", "Remaining", "Status", "Due", "Note"],
    tableRows: transactionRows(data.transactions).map((row) => row.map((cell, index) => index === 7 || (index === 8 && cell !== "") ? money(cell) : cell)),
    additionalTables: [{
      title: "Obligation and Settlement History",
      headers: ["Obligation ID", "Source Tx", "Person", "Type", "Dir", "Original", "Settled", "Remaining", "Status", "Due", "Paid/Recv", "Account", "Allocation"],
      widths: [90, 90, 60, 65, 32, 48, 48, 48, 60, 55, 55, 55, 50],
      maxChars: 28,
      rows: data.obligationRows.map((row) => row.map((cell, index) => [5, 6, 7, 12].includes(index) ? money(cell) : cell))
    }, {
      title: "Financial Activity History",
      headers: ["Date", "Time", "Event", "Tx Type", "Person", "Account", "Amount", "Source Tx", "Obligation", "Settlement", "Original", "Before", "After", "Status", "Note"],
      widths: [48, 42, 58, 56, 55, 55, 48, 72, 72, 72, 48, 48, 48, 50, 70],
      maxChars: 26,
      rows: data.activityRows.map((row) => row.map((cell, index) => [6, 10, 11, 12].includes(index) && cell !== "" ? money(cell) : cell))
    }]
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=${filename(req.query, "pdf")}`);
  res.send(pdf);
});

export const exportExcelReport = asyncHandler(async (req, res) => {
  const data = await reportData(req);
  const summaryRows = [
    ["Report", "Expense Report"],
    ["User", req.user.name],
    ["Generated", new Date().toLocaleString("en-IN")],
    ["Filters", filterLines(req.query).join(" · ") || "Full report"],
    [],
    ["Metric", "Amount"],
    ["Income", data.totals.income],
    ["Expense", data.totals.expense],
    ["To Receive", data.totals.toReceive],
    ["To Pay", data.totals.toPay],
    ["Lent Outstanding", data.totals.lentOutstanding],
    ["Paid for Someone Outstanding", data.totals.paidForSomeoneOutstanding],
    ["Borrowed Outstanding", data.totals.borrowedOutstanding],
    ["Someone Paid for Me Outstanding", data.totals.someonePaidForMeOutstanding],
    ["Borrowed", data.totals.borrowed],
    ["Lent", data.totals.lent],
    ["Settlements", data.totals.settlements],
    ["Received Back", data.totals.receivedBack],
    ["Paid Back", data.totals.paidBack],
    ["Savings", data.totals.savings]
  ];
  const workbook = createXlsx([
    { name: "Summary", rows: summaryRows },
    { name: "Transactions", rows: [["Date", "Time", "Type", "Person", "Account", "Category", "Tags", "Amount", "Remaining", "Status", "Due Date", "Note"], ...transactionRows(data.transactions)] },
    { name: "Obligation History", rows: [["Obligation ID", "Source Transaction ID", "Person", "Type", "Direction", "Original Amount", "Settled Amount", "Remaining Amount", "Status", "Due Date", "Settlement Date", "Settlement Account", "Allocation Amount"], ...data.obligationRows] },
    { name: "Activity History", rows: [["Date", "Time", "Event Type", "Transaction Type", "Person", "Account", "Amount", "Source Transaction", "Obligation", "Settlement", "Original Amount", "Remaining Before", "Remaining After", "Status", "Note"], ...data.activityRows] },
    { name: "People Balances", rows: [["Name", "Balance"], ...data.people.map((person) => [person.name, Number(person.rawBalance || 0)])] },
    { name: "Accounts", rows: [["Name", "Type", "Balance"], ...data.accounts.map((account) => [account.name, account.type, Number(account.currentBalance || 0)])] }
  ]);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=${filename(req.query, "xlsx")}`);
  res.send(workbook);
});
