import mongoose from "mongoose";
import { createHash } from "node:crypto";
import Account from "../models/Account.js";
import Category from "../models/Category.js";
import Person from "../models/Person.js";
import Tag from "../models/Tag.js";
import Settlement from "../models/Settlement.js";
import Transaction from "../models/Transaction.js";
import Obligation from "../models/Obligation.js";
import ObligationEvent from "../models/ObligationEvent.js";
import TransactionAudit from "../models/TransactionAudit.js";
import Notification from "../models/Notification.js";
import SettlementAllocation from "../models/SettlementAllocation.js";
import FinancialRequest from "../models/FinancialRequest.js";
import User from "../models/User.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { successResponse } from "../utils/apiResponse.js";
import { applyTransactionAccountEffects } from "../services/accountingEngine.js";
import { recordTransactionAuditActivity, recordTransactionCreatedActivity } from "../services/activityEventService.js";
import { createObligationForTransaction, ensureUserObligations, recalculateObligation, refreshUserObligationStatuses } from "../services/obligationService.js";
import { createSettlement } from "./obligationController.js";
import {
  INCOME_TYPES,
  LOAN_TYPES,
  OPEN_REPAYMENT_STATUSES,
  PAYABLE_TYPES,
  PERSONAL_EXPENSE_TYPES,
  RECEIVABLE_TYPES,
  SETTLEMENT_TYPES,
  directionTypes,
  classifyObligation,
  dueDateMatch,
  incomeValue,
  normalizeFinanceTimeZone,
  payableSettlementExpenseMatch,
  payableSettlementExpenseObligationMatch,
  personalExpenseAmountExpression,
  personalExpenseValue,
  summarizeOutstandingByType
} from "../utils/financeRules.js";

const PERSON_TYPES = [...LOAN_TYPES, ...SETTLEMENT_TYPES];
const REPORT_TYPES = [
  "INCOME",
  "EXPENSE",
  "TO_RECEIVE",
  "TO_PAY",
  "BORROWED",
  "LENT",
  "SETTLEMENTS",
  "SAVINGS"
];

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function parseAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError("Amount must be greater than 0", 400);
  }
  return amount;
}

function normalizeTransactionPayload(body, userId) {
  const type = body.type;
  const amount = parseAmount(body.amount);
  const payload = {
    userId,
    createdBy: userId,
    type,
    amount,
    account: type === "PAID_BY_SOMEONE" ? null : body.account,
    destinationAccount: body.destinationAccount || undefined,
    person: body.person || undefined,
    category: body.category || undefined,
    tags: Array.isArray(body.tags) ? body.tags.filter(Boolean) : [],
    note: body.note || "",
    transactionDate: body.transactionDate,
    transactionTime: body.transactionTime,
    dueDate: body.dueDate || undefined,
    status: body.status || "ACTIVE",
    reminderEnabled: Boolean(body.reminderEnabled ?? (LOAN_TYPES.includes(type) && body.dueDate)),
    reminderStartDaysBefore: Number(body.reminderStartDaysBefore ?? 3),
    reminderTimes: Array.isArray(body.reminderTimes) && body.reminderTimes.length
      ? body.reminderTimes.slice(0, 3)
      : ["09:00", "14:00", "19:00"]
  };

  if (LOAN_TYPES.includes(type)) {
    payload.originalAmount = Number(body.originalAmount ?? amount);
    payload.remainingAmount = Number(body.remainingAmount ?? amount);
    payload.repaymentStatus = body.repaymentStatus || "PENDING";
  } else {
    payload.originalAmount = undefined;
    payload.remainingAmount = undefined;
    payload.repaymentStatus = "NONE";
    payload.reminderEnabled = false;
    payload.dueDate = undefined;
  }

  return payload;
}

function validateTransactionPayload(payload) {
  const validTypes = ["EXPENSE", "INCOME", "BORROW", "LEND", "PAID_FOR_SOMEONE", "PAID_BY_SOMEONE", "TRANSFER", "REPAYMENT_RECEIVED", "REPAYMENT_PAID", "SPLIT_EXPENSE"];
  if (!validTypes.includes(payload.type)) throw new ApiError("Invalid transaction type", 400);
  if (payload.type !== "PAID_BY_SOMEONE" && (!payload.account || !isValidId(payload.account))) {
    throw new ApiError("Valid account is required", 400);
  }
  if (!payload.transactionDate) throw new ApiError("Transaction date is required", 400);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.transactionTime || "")) {
    throw new ApiError("Valid transaction time is required", 400);
  }

  if (payload.type === "TRANSFER") {
    if (!payload.destinationAccount || !isValidId(payload.destinationAccount)) {
      throw new ApiError("Destination account is required for transfer", 400);
    }
    if (String(payload.account) === String(payload.destinationAccount)) {
      throw new ApiError("Source and destination accounts must be different", 400);
    }
  }

  if (PERSON_TYPES.includes(payload.type) && (!payload.person || !isValidId(payload.person))) {
    throw new ApiError("Person is required for this transaction type", 400);
  }

  if (payload.category && !isValidId(payload.category)) throw new ApiError("Invalid category", 400);
  if (payload.tags.some((tag) => !isValidId(tag))) throw new ApiError("Invalid tag", 400);
  const reminderTimes = Array.isArray(payload.reminderTimes) ? payload.reminderTimes : [];
  if (reminderTimes.length > 3) throw new ApiError("Up to 3 reminder times are allowed", 400);
}

async function assertOwnedReferences(payload, userId, session) {
  let account = null;
  if (payload.account) {
    account = await Account.findOne({ _id: payload.account, userId, isActive: true }).session(session);
    if (!account) throw new ApiError("Account not found", 404);
  }

  let destinationAccount = null;
  if (payload.destinationAccount) {
    destinationAccount = await Account.findOne({
      _id: payload.destinationAccount,
      userId,
      isActive: true
    }).session(session);
    if (!destinationAccount) throw new ApiError("Destination account not found", 404);
  }

  if (payload.person) {
    const person = await Person.findOne({ _id: payload.person, userId, isActive: true }).session(session);
    if (!person) throw new ApiError("Person not found", 404);
  }

  if (payload.category) {
    const category = await Category.findOne({ _id: payload.category, userId, isActive: true }).session(session);
    if (!category) throw new ApiError("Category not found", 404);
  }

  if (payload.tags.length) {
    const tagCount = await Tag.countDocuments({ _id: { $in: payload.tags }, userId }).session(session);
    if (tagCount !== payload.tags.length) throw new ApiError("One or more tags were not found", 404);
  }

  return { account, destinationAccount };
}

function requireRequestKey(req) {
  const key = String(req.get("Idempotency-Key") || "").trim();
  if (!key || key.length > 128) throw new ApiError("A valid request key is required", 400);
  return key;
}

async function replayRequest(req, res, requestKey, message, status = 201) {
  const prior = await FinancialRequest.findOne({ userId: req.userId, requestKey });
  if (!prior) return false;
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ method: req.method, path: req.path, body: req.body }))
    .digest("hex");
  if (prior.payloadHash !== payloadHash) {
    throw new ApiError("This request key was already used for a different action", 409);
  }
  const transactions = await populateQuery(Transaction.find({
    _id: { $in: prior.transactionIds }, userId: req.userId
  }));
  successResponse(res, transactions.length === 1 ? transactions[0] : transactions, message, status);
  return true;
}

async function recordRequest(req, requestKey, transactions, session) {
  await FinancialRequest.create([{
    userId: req.userId,
    requestKey,
    payloadHash: createHash("sha256")
      .update(JSON.stringify({ method: req.method, path: req.path, body: req.body }))
      .digest("hex"),
    transactionIds: transactions.map((transaction) => transaction._id),
    createdBy: req.userId
  }], { session });
}

function buildFilters(query, userId) {
  const filters = { userId };
  const map = ["type", "account", "person", "category", "status"];

  map.forEach((field) => {
    if (query[field]) filters[field] = query[field];
  });

  if (query.tag) filters.tags = query.tag;
  if (query.q) {
    filters.note = { $regex: String(query.q).trim(), $options: "i" };
  }

  const dateRange = resolveDateRange(query);
  if (dateRange) filters.transactionDate = dateRange;

  if (query.direction || query.due) {
    const direction = String(query.direction || "").toUpperCase();
    const due = String(query.due || "").toUpperCase();
    if (!["PAYABLE", "RECEIVABLE"].includes(direction)) {
      throw new ApiError("A valid direction is required for due filters", 400);
    }
    if (!["TODAY", "UPCOMING", "OVERDUE"].includes(due)) {
      throw new ApiError("A valid due period is required", 400);
    }
    const allowedTypes = directionTypes(direction);
    filters.type = query.type
      ? (allowedTypes.includes(query.type) ? query.type : { $in: [] })
      : { $in: allowedTypes };
    filters.status = "ACTIVE";
    filters.repaymentStatus = { $in: OPEN_REPAYMENT_STATUSES };
    filters.remainingAmount = { $gt: 0 };
    delete filters.transactionDate;

    const dueMatch = dueDateMatch(due, query.timeZone);
    if (dueMatch) Object.assign(filters, dueMatch);
  }

  const dashboardViews = {
    account_history: {},
    income: { type: "INCOME" },
    personal_expense: { type: { $in: PERSONAL_EXPENSE_TYPES } },
    to_receive: { type: { $in: RECEIVABLE_TYPES }, outstanding: true },
    to_pay: { type: { $in: PAYABLE_TYPES }, outstanding: true },
    lent_outstanding: { type: "LEND", outstanding: true },
    paid_for_someone_outstanding: { type: "PAID_FOR_SOMEONE", outstanding: true },
    borrowed_outstanding: { type: "BORROW", outstanding: true },
    someone_paid_for_me_outstanding: { type: "PAID_BY_SOMEONE", outstanding: true },
    received_back: { type: "REPAYMENT_RECEIVED" },
    paid_back: { type: "REPAYMENT_PAID" }
  };
  if (["upcoming_due", "overdue"].includes(query.dashboardFilter)) {
    throw new ApiError("Use direction and due filters for due transactions", 400);
  }
  const dashboardView = dashboardViews[query.dashboardFilter];
  if (dashboardView) {
    if (dashboardView.type) filters.type = dashboardView.type;
    if (dashboardView.outstanding) {
      delete filters.transactionDate;
      filters.repaymentStatus = { $in: OPEN_REPAYMENT_STATUSES };
      filters.remainingAmount = { $gt: 0 };
    }
  }

  if (query.balanceStatus === "pending" || query.pending === "true") {
    filters.repaymentStatus = { $in: OPEN_REPAYMENT_STATUSES };
    filters.remainingAmount = { $gt: 0 };
  }
  if (query.balanceStatus === "partial") {
    filters.repaymentStatus = "PARTIAL";
    filters.remainingAmount = { $gt: 0 };
  }
  if (query.balanceStatus === "settled" || query.settled === "true") {
    filters.$or = [{ repaymentStatus: "PAID" }, { remainingAmount: { $lte: 0 } }];
  }
  if (["overdue_payable", "overdue_receivable"].includes(query.balanceStatus)) {
    filters.type = { $in: query.balanceStatus === "overdue_payable" ? PAYABLE_TYPES : RECEIVABLE_TYPES };
    filters.status = "ACTIVE";
    filters.repaymentStatus = { $in: OPEN_REPAYMENT_STATUSES };
    filters.remainingAmount = { $gt: 0 };
    Object.assign(filters, dueDateMatch("OVERDUE", query.timeZone));
    delete filters.transactionDate;
  } else if (query.balanceStatus === "overdue") {
    filters.type = { $in: [...PAYABLE_TYPES, ...RECEIVABLE_TYPES] };
    filters.status = "ACTIVE";
    filters.repaymentStatus = { $in: OPEN_REPAYMENT_STATUSES };
    filters.remainingAmount = { $gt: 0 };
    Object.assign(filters, dueDateMatch("OVERDUE", query.timeZone));
    delete filters.transactionDate;
  } else if (query.overdue === "true") {
    throw new ApiError("Choose payable or receivable for overdue filters", 400);
  }

  return filters;
}

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
  } else if (query.period === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    start = startOfDay(yesterday);
    end = endExclusive(yesterday);
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
  } else if (query.exactDate) {
    start = startOfDay(new Date(query.exactDate));
    end = endExclusive(start);
  } else if (query.month && query.year) {
    start = new Date(Number(query.year), Number(query.month) - 1, 1);
    end = new Date(Number(query.year), Number(query.month), 1);
  } else if (query.year) {
    start = new Date(Number(query.year), 0, 1);
    end = new Date(Number(query.year) + 1, 0, 1);
  }

  if (!start && !end) return null;
  return {
    ...(start ? { $gte: start } : {}),
    ...(end ? { $lt: end } : {})
  };
}

function sortOption(sort = "newest") {
  const options = {
    newest: { transactionDate: -1, transactionTime: -1, createdAt: -1 },
    oldest: { transactionDate: 1, transactionTime: 1, createdAt: 1 },
    amount_high: { amount: -1, transactionDate: -1 },
    amount_low: { amount: 1, transactionDate: -1 },
    due_soon: { dueDate: 1, transactionDate: -1 }
  };
  return options[sort] || options.newest;
}

function populateQuery(query) {
  return query
    .populate("account", "name type currentBalance")
    .populate("destinationAccount", "name type currentBalance")
    .populate("person", "name avatarColor")
    .populate("category", "name type color icon")
    .populate("tags", "name color");
}

async function attachLinkedObligations(transactions, userId, { includeEvents = false } = {}) {
  const list = Array.isArray(transactions) ? transactions : [transactions];
  const plain = list.map((item) => item?.toObject ? item.toObject() : item);
  const ids = plain.map((item) => item?._id).filter(Boolean);
  if (!ids.length) return Array.isArray(transactions) ? plain : plain[0];
  const obligations = await Obligation.find({ userId, sourceTransaction: { $in: ids } }).lean();
  const byTransaction = new Map(obligations.map((item) => [String(item.sourceTransaction), item]));
  let eventsByObligation = new Map();
  if (includeEvents && obligations.length) {
    const events = await ObligationEvent.find({ userId, obligation: { $in: obligations.map((item) => item._id) } })
      .sort({ createdAt: 1 })
      .populate({ path: "settlement", match: { userId }, select: "direction totalAmount amount settlementDate settlementTime note account", populate: { path: "account", select: "name type" } })
      .lean();
    eventsByObligation = events.reduce((map, event) => map.set(String(event.obligation), [...(map.get(String(event.obligation)) || []), event]), new Map());
  }
  const enriched = plain.map((item) => {
    const obligation = byTransaction.get(String(item._id));
    if (!obligation) return item;
    return {
      ...item,
      linkedObligation: {
        _id: obligation._id,
        direction: obligation.direction,
        sourceType: obligation.sourceType,
        originalAmount: obligation.originalAmount,
        settledAmount: obligation.settledAmount,
        remainingAmount: obligation.remainingAmount,
        status: obligation.status,
        dueDate: obligation.dueDate,
        events: includeEvents ? eventsByObligation.get(String(obligation._id)) || [] : undefined
      }
    };
  });
  return Array.isArray(transactions) ? enriched : enriched[0];
}

export const listTransactions = asyncHandler(async (req, res) => {
  if (req.query.direction || req.query.due || req.query.balanceStatus === "pending" || req.query.dashboardFilter?.includes("outstanding")) {
    await ensureUserObligations(req.userId);
    await refreshUserObligationStatuses(req.userId);
  }
  const limit = Math.min(Number(req.query.limit || 100), 200);
  const page = Math.max(Number(req.query.page || 1), 1);
  const unpaginatedDueList = Boolean(req.query.direction && req.query.due);
  let transactionQuery = Transaction.find(buildFilters(req.query, req.userId)).sort(sortOption(req.query.sort));
  if (!req.query.dashboardFilter && !unpaginatedDueList) transactionQuery = transactionQuery.skip((page - 1) * limit).limit(limit);
  const transactions = await attachLinkedObligations(await populateQuery(transactionQuery), req.userId);
  if (req.query.paginated === "true") {
    const total = await Transaction.countDocuments(buildFilters(req.query, req.userId));
    successResponse(res, { items: transactions, page, limit, total }, "Transaction list fetched");
    return;
  }
  successResponse(res, transactions, "Transaction list fetched");
});

function reportBaseMatch(query, userId) {
  const filters = buildFilters(query, userId);
  const directionalDueFilter = (query.direction && query.due)
    || ["overdue_payable", "overdue_receivable"].includes(query.balanceStatus);
  if (!directionalDueFilter) delete filters.type;
  delete filters.status;
  return { ...filters, status: "ACTIVE" };
}

async function sumByMatch(match, amountExpression = "$amount") {
  const rows = await Transaction.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: amountExpression } } }
  ]);
  return rows[0]?.total || 0;
}

function settlementSum(userId, directions, dateRange, filters = {}) {
  return Settlement.aggregate([
    { $match: {
      userId,
      status: "ACTIVE",
      direction: { $in: directions },
      ...(dateRange ? { settlementDate: dateRange } : {}),
      ...(filters.account ? { account: filters.account } : {}),
      ...(filters.person ? { person: filters.person } : {})
    } },
    { $group: { _id: null, total: { $sum: { $ifNull: ["$totalAmount", "$amount"] } } } }
  ]).then((rows) => Number(rows[0]?.total || 0));
}

function payableSettlementExpensePipeline(userId, dateRange, filters = {}, groupStage = { _id: null }) {
  return [
    { $match: payableSettlementExpenseMatch(userId, dateRange, filters) },
    { $lookup: { from: "settlementallocations", localField: "_id", foreignField: "settlement", as: "allocation" } },
    { $unwind: "$allocation" },
    { $match: { "allocation.userId": userId } },
    { $lookup: { from: "obligations", localField: "allocation.obligation", foreignField: "_id", as: "obligation" } },
    { $unwind: "$obligation" },
    { $match: payableSettlementExpenseObligationMatch(userId) },
    { $lookup: { from: "transactions", localField: "obligation.sourceTransaction", foreignField: "_id", as: "sourceTransaction" } },
    { $unwind: { path: "$sourceTransaction", preserveNullAndEmptyArrays: true } },
    { $match: { $or: [{ "sourceTransaction._id": { $exists: false } }, { "sourceTransaction.userId": userId }] } },
    { $group: { ...groupStage, total: { $sum: "$allocation.amount" }, count: { $sum: 1 } } }
  ];
}

function payableSettlementExpenseSum(userId, dateRange, filters = {}) {
  return Settlement.aggregate(payableSettlementExpensePipeline(userId, dateRange, filters))
    .then((rows) => Number(rows[0]?.total || 0));
}

function mergeSeries(...series) {
  const map = new Map();
  for (const rows of series) {
    for (const row of rows) {
      const key = typeof row._id === "object" ? JSON.stringify(row._id) : String(row._id);
      const current = map.get(key) || { ...row, income: 0, expense: 0, total: 0 };
      current.income += Number(row.income || 0);
      current.expense += Number(row.expense || row.total || 0);
      current.total += Number(row.total || 0);
      map.set(key, current);
    }
  }
  return [...map.values()].sort((a, b) => String(a._id).localeCompare(String(b._id)));
}

export const getTransactionReports = asyncHandler(async (req, res) => {
  await ensureUserObligations(req.userId);
  await refreshUserObligationStatuses(req.userId);
  const match = reportBaseMatch(req.query, req.userId);
  const now = new Date();
  const year = Number(req.query.year || now.getFullYear());
  const trendStart = new Date(year, 0, 1);
  const trendEnd = new Date(year + 1, 0, 1);

  const [
    income,
    personalExpense,
    outstanding,
    borrowed,
    lent,
    settlementsReceived,
    settlementsPaid,
    settlementPersonalExpense,
    categorySpending,
    settlementCategorySpending,
    cashFlow,
    settlementCashFlow,
    monthlyTrend,
    settlementMonthlyTrend
  ] = await Promise.all([
    sumByMatch({ ...match, type: { $in: INCOME_TYPES } }),
    sumByMatch({ ...match, type: { $in: PERSONAL_EXPENSE_TYPES } }, personalExpenseAmountExpression()),
    Obligation.aggregate([
      {
        $match: {
          userId: req.userId,
          status: { $nin: ["SETTLED", "CANCELLED"] },
          remainingAmount: { $gt: 0 }
        }
      },
      { $group: { _id: "$sourceType", total: { $sum: "$remainingAmount" } } }
    ]),
    sumByMatch({ ...match, type: "BORROW" }),
    sumByMatch({ ...match, type: { $in: RECEIVABLE_TYPES } }),
    settlementSum(req.userId, ["RECEIPT", "RECEIVED_BY_ME"], match.transactionDate, match),
    settlementSum(req.userId, ["PAYMENT", "PAID_BY_ME"], match.transactionDate, match),
    payableSettlementExpenseSum(req.userId, match.transactionDate, match),
    Transaction.aggregate([
      { $match: { ...match, type: { $in: PERSONAL_EXPENSE_TYPES } } },
      {
        $group: {
          _id: "$category",
          total: { $sum: personalExpenseAmountExpression() },
          count: { $sum: 1 }
        }
      },
      { $sort: { total: -1 } },
      { $limit: 8 },
      { $lookup: { from: "categories", localField: "_id", foreignField: "_id", as: "category" } },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          categoryId: "$_id",
          name: { $ifNull: ["$category.name", "Uncategorized"] },
          color: { $ifNull: ["$category.color", "coral"] },
          total: 1,
          count: 1
        }
      }
    ]),
    Settlement.aggregate([
      ...payableSettlementExpensePipeline(req.userId, match.transactionDate, match, { _id: "$sourceTransaction.category" }),
      { $sort: { total: -1 } },
      { $limit: 8 },
      { $lookup: { from: "categories", localField: "_id", foreignField: "_id", as: "category" } },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          categoryId: "$_id",
          name: { $ifNull: ["$category.name", "Uncategorized"] },
          color: { $ifNull: ["$category.color", "coral"] },
          total: 1,
          count: 1
        }
      }
    ]),
    Transaction.aggregate([
      { $match: { ...match, type: { $in: [...INCOME_TYPES, ...PERSONAL_EXPENSE_TYPES] } } },
      {
        $group: {
          _id: { $dateToString: { date: "$transactionDate", format: "%Y-%m-%d" } },
          income: { $sum: { $cond: [{ $in: ["$type", INCOME_TYPES] }, "$amount", 0] } },
          expense: {
            $sum: {
              $cond: [{ $in: ["$type", PERSONAL_EXPENSE_TYPES] }, personalExpenseAmountExpression(), 0]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    Settlement.aggregate([
      ...payableSettlementExpensePipeline(req.userId, match.transactionDate, match, {
        _id: { $dateToString: { date: "$settlementDate", format: "%Y-%m-%d" } }
      }),
      { $project: { _id: 1, income: { $literal: 0 }, expense: "$total" } },
      { $sort: { _id: 1 } }
    ]),
    Transaction.aggregate([
      {
        $match: {
          ...match,
          transactionDate: { $gte: trendStart, $lt: trendEnd },
          type: { $in: [...INCOME_TYPES, ...PERSONAL_EXPENSE_TYPES] }
        }
      },
      {
        $group: {
          _id: { month: { $month: "$transactionDate" } },
          income: { $sum: { $cond: [{ $in: ["$type", INCOME_TYPES] }, "$amount", 0] } },
          expense: {
            $sum: {
              $cond: [{ $in: ["$type", PERSONAL_EXPENSE_TYPES] }, personalExpenseAmountExpression(), 0]
            }
          }
        }
      },
      { $sort: { "_id.month": 1 } },
      { $project: { _id: 0, month: "$_id.month", income: 1, expense: 1 } }
    ]),
    Settlement.aggregate([
      ...payableSettlementExpensePipeline(req.userId, { $gte: trendStart, $lt: trendEnd }, match, {
        _id: { month: { $month: "$settlementDate" } }
      }),
      { $sort: { "_id.month": 1 } },
      { $project: { _id: 0, month: "$_id.month", income: { $literal: 0 }, expense: "$total" } }
    ])
  ]);

  const outstandingTotals = summarizeOutstandingByType(outstanding);
  const totalPersonalExpense = Number(personalExpense || 0) + Number(settlementPersonalExpense || 0);
  const categoryTotals = [...categorySpending, ...settlementCategorySpending].reduce((map, row) => {
    const key = String(row.categoryId || "uncategorized");
    const current = map.get(key) || { ...row, total: 0, count: 0 };
    current.total += Number(row.total || 0);
    current.count += Number(row.count || 0);
    map.set(key, current);
    return map;
  }, new Map());

  successResponse(
    res,
    {
      totals: {
        income,
        personalExpense: totalPersonalExpense,
        toReceive: outstandingTotals.totalToReceive,
        toPay: outstandingTotals.totalToPay,
        lentOutstanding: outstandingTotals.lentOutstanding,
        paidForSomeoneOutstanding: outstandingTotals.paidForSomeoneOutstanding,
        borrowedOutstanding: outstandingTotals.borrowedOutstanding,
        someonePaidForMeOutstanding: outstandingTotals.someonePaidForMeOutstanding,
        borrowed,
        lent,
        settlements: settlementsReceived + settlementsPaid,
        settlementReceived: settlementsReceived,
        settlementPaid: settlementsPaid,
        savings: income - totalPersonalExpense
      },
      charts: {
        cashFlow: mergeSeries(cashFlow, settlementCashFlow),
        categorySpending: [...categoryTotals.values()].sort((a, b) => Number(b.total || 0) - Number(a.total || 0)).slice(0, 8),
        monthlyTrend: mergeSeries(monthlyTrend.map((row) => ({ _id: row.month, ...row })), settlementMonthlyTrend.map((row) => ({ _id: row.month, ...row }))).map((row) => ({ month: row.month ?? Number(row._id), income: row.income, expense: row.expense }))
      },
      reportTypes: REPORT_TYPES
    },
    "Transaction reports fetched"
  );
});

export const getTransactionById = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) throw new ApiError("Invalid transaction id", 400);
  const transaction = await attachLinkedObligations(await populateQuery(Transaction.findOne({ _id: req.params.id, userId: req.userId })), req.userId, { includeEvents: true });
  if (!transaction) throw new ApiError("Transaction not found", 404);
  const history = await TransactionAudit.find({ transaction: transaction._id, userId: req.userId }).sort({ createdAt: 1 });
  successResponse(res, { transaction, history }, "Transaction fetched");
});

export const createTransaction = asyncHandler(async (req, res) => {
  const requestKey = requireRequestKey(req);
  if (await replayRequest(req, res, requestKey, "Transaction saved successfully.")) return;
  const session = await mongoose.startSession();

  try {
    let created;
    await session.withTransaction(async () => {
      const payload = { ...normalizeTransactionPayload(req.body, req.userId), requestKey };
      validateTransactionPayload(payload);
      await assertOwnedReferences(payload, req.userId, session);
      [created] = await Transaction.create([payload], { session });
      await applyTransactionAccountEffects(created, req.userId, session, 1);
      const obligation = await createObligationForTransaction(created, req.userId, session);
      await recordTransactionCreatedActivity({ transaction: created, obligation, userId: req.userId, session });
      await recordRequest(req, requestKey, [created], session);
    });

    const transaction = await populateQuery(Transaction.findById(created._id));
    successResponse(res, transaction, "Transaction saved successfully.", 201);
  } catch (error) {
    if (error.code === 11000 && await replayRequest(req, res, requestKey, "Transaction saved successfully.")) return;
    throw error;
  } finally {
    await session.endSession();
  }
});

export const updateTransaction = asyncHandler(async (req, res) => {
  const requestKey = requireRequestKey(req);
  if (await replayRequest(req, res, requestKey, "Transaction updated successfully.", 200)) return;
  if (!isValidId(req.params.id)) throw new ApiError("Invalid transaction id", 400);
  const session = await mongoose.startSession();

  try {
    let updated;
    await session.withTransaction(async () => {
      const existing = await Transaction.findOne({ _id: req.params.id, userId: req.userId }).session(session);
      if (!existing) throw new ApiError("Transaction not found", 404);
      if (existing.status === "CANCELLED") throw new ApiError("Cancelled transactions cannot be updated", 409);
      if (existing.type === "SPLIT_EXPENSE") throw new ApiError("Split expenses with linked participant obligations cannot be edited; cancel and recreate them", 409);
      const before = existing.toObject();

      await applyTransactionAccountEffects(existing, req.userId, session, -1);

      const payload = { ...normalizeTransactionPayload({ ...existing.toObject(), ...req.body, status: "ACTIVE" }, req.userId), requestKey, version: Number(existing.version || 0) + 1 };
      validateTransactionPayload(payload);
      await assertOwnedReferences(payload, req.userId, session);

      updated = await Transaction.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId },
        payload,
        { new: true, runValidators: true, session }
      );
      const obligation = await Obligation.findOne({ userId: req.userId, sourceTransaction: existing._id }).session(session);
      if (obligation) {
        if (payload.type !== existing.type) throw new ApiError("An obligation transaction cannot change type; create a correction instead", 409);
        const allocations = await SettlementAllocation.countDocuments({ userId: req.userId, obligation: obligation._id }).session(session);
        const oldOriginalAmount = Number(obligation.originalAmount);
        const oldDueDate = obligation.dueDate ? new Date(obligation.dueDate).toISOString() : "";
        const oldStatus = obligation.status;
        if (allocations && (
          payload.type !== existing.type
          || String(payload.person || "") !== String(existing.person || "")
          || Number(payload.amount) !== Number(existing.amount)
          || Number(payload.originalAmount ?? payload.amount) < Number(obligation.settledAmount || 0)
        )) throw new ApiError("An obligation with settlement history cannot change its type, person, or settled value", 409);
        obligation.originalAmount = Number(payload.originalAmount ?? payload.amount);
        obligation.person = payload.person;
        obligation.dueDate = payload.dueDate;
        await recalculateObligation(obligation, session);
        await Notification.updateMany(
          { userId: req.userId, obligation: obligation._id, status: { $ne: "ARCHIVED" } },
          { status: "ARCHIVED" },
          { session }
        );
        if (oldOriginalAmount !== obligation.originalAmount || oldDueDate !== (obligation.dueDate ? new Date(obligation.dueDate).toISOString() : "")) {
          await ObligationEvent.create([{
            userId: req.userId,
            obligation: obligation._id,
            sourceTransaction: existing._id,
            eventType: "CORRECTED",
            statusBefore: oldStatus,
            statusAfter: obligation.status,
            remainingAfter: obligation.remainingAmount,
            createdBy: req.userId,
            metadata: { originalAmountBefore: oldOriginalAmount, originalAmountAfter: obligation.originalAmount, dueDateBefore: oldDueDate, dueDateAfter: obligation.dueDate }
          }], { session });
        }
      } else await createObligationForTransaction(updated, req.userId, session);
      await applyTransactionAccountEffects(updated, req.userId, session, 1);
      await TransactionAudit.create([{
        userId: req.userId,
        transaction: existing._id,
        action: "UPDATED",
        version: Number(existing.version || 0) + 1,
        before,
        after: updated.toObject(),
        createdBy: req.userId,
        requestKey
      }], { session });
      const [audit] = await TransactionAudit.find({ userId: req.userId, transaction: existing._id, requestKey }).sort({ createdAt: -1 }).limit(1).session(session);
      if (audit) await recordTransactionAuditActivity({ transaction: updated, audit, action: "UPDATED", userId: req.userId, session });
      await recordRequest(req, requestKey, [updated], session);
    });

    const transaction = await populateQuery(Transaction.findById(updated._id));
    successResponse(res, transaction, "Transaction updated successfully.");
  } catch (error) {
    if (error.code === 11000 && await replayRequest(req, res, requestKey, "Transaction updated successfully.", 200)) return;
    throw error;
  } finally {
    await session.endSession();
  }
});

export const cancelTransaction = asyncHandler(async (req, res) => {
  const requestKey = requireRequestKey(req);
  if (await replayRequest(req, res, requestKey, "Transaction cancelled successfully.", 200)) return;
  if (!isValidId(req.params.id)) throw new ApiError("Invalid transaction id", 400);
  const session = await mongoose.startSession();

  try {
    let cancelled;
    await session.withTransaction(async () => {
      const existing = await Transaction.findOne({ _id: req.params.id, userId: req.userId }).session(session);
      if (!existing) throw new ApiError("Transaction not found", 404);
      if (existing.status === "CANCELLED") {
        cancelled = existing;
        return;
      }
      const before = existing.toObject();

      if (existing.type === "SPLIT_EXPENSE") {
        const children = await Transaction.find({ userId: req.userId, parentTransaction: existing._id, status: "ACTIVE" }).session(session);
        for (const child of children) {
          const obligation = await Obligation.findOne({ userId: req.userId, sourceTransaction: child._id }).session(session);
          if (!obligation) continue;
          const allocationCount = await SettlementAllocation.countDocuments({ userId: req.userId, obligation: obligation._id }).session(session);
          if (allocationCount) throw new ApiError("A split participant obligation has settlement history; reverse it with a correction", 409);
          const statusBefore = obligation.status;
          obligation.status = "CANCELLED";
          obligation.remainingAmount = 0;
          obligation.version = Number(obligation.version || 0) + 1;
          await obligation.save({ session });
          await Notification.updateMany(
            { userId: req.userId, obligation: obligation._id, status: { $ne: "ARCHIVED" } },
            { status: "ARCHIVED" },
            { session }
          );
          await Transaction.updateOne({ _id: child._id, userId: req.userId }, { $set: { status: "CANCELLED" }, $inc: { version: 1 } }, { session });
          await ObligationEvent.create([{
            userId: req.userId,
            obligation: obligation._id,
            sourceTransaction: child._id,
            eventType: "CANCELLED",
            statusBefore,
            statusAfter: "CANCELLED",
            remainingBefore: Number(child.remainingAmount || child.amount || 0),
            remainingAfter: 0,
            createdBy: req.userId
          }], { session });
        }
      }

      const obligation = await Obligation.findOne({ userId: req.userId, sourceTransaction: existing._id }).session(session);
      if (obligation) {
        const allocationCount = await SettlementAllocation.countDocuments({ userId: req.userId, obligation: obligation._id }).session(session);
        if (allocationCount) throw new ApiError("This transaction has settlement history; reverse its obligation instead of deleting it", 409);
        const statusBefore = obligation.status;
        obligation.status = "CANCELLED";
        obligation.remainingAmount = 0;
        obligation.version = Number(obligation.version || 0) + 1;
        await obligation.save({ session });
        await Notification.updateMany(
          { userId: req.userId, obligation: obligation._id, status: { $ne: "ARCHIVED" } },
          { status: "ARCHIVED" },
          { session }
        );
        await ObligationEvent.create([{
          userId: req.userId,
          obligation: obligation._id,
          sourceTransaction: existing._id,
          eventType: "CANCELLED",
          statusBefore,
          statusAfter: "CANCELLED",
          remainingBefore: Number(existing.remainingAmount || existing.amount || 0),
          remainingAfter: 0,
          createdBy: req.userId
        }], { session });
      }

      await applyTransactionAccountEffects(existing, req.userId, session, -1);
      cancelled = await Transaction.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId },
        { status: "CANCELLED", $inc: { version: 1 } },
        { new: true, runValidators: true, session }
      );
      await TransactionAudit.create([{
        userId: req.userId,
        transaction: existing._id,
        action: "CANCELLED",
        version: Number(existing.version || 0) + 1,
        before,
        after: cancelled.toObject(),
        createdBy: req.userId,
        requestKey
      }], { session });
      const [audit] = await TransactionAudit.find({ userId: req.userId, transaction: existing._id, requestKey }).sort({ createdAt: -1 }).limit(1).session(session);
      if (audit) await recordTransactionAuditActivity({ transaction: cancelled, audit, action: "CANCELLED", userId: req.userId, session });
      await recordRequest(req, requestKey, [cancelled], session);
    });

    const transaction = await populateQuery(Transaction.findById(cancelled._id));
    successResponse(res, transaction, "Transaction cancelled successfully.");
  } catch (error) {
    if (error.code === 11000 && await replayRequest(req, res, requestKey, "Transaction cancelled successfully.", 200)) return;
    throw error;
  } finally {
    await session.endSession();
  }
});

export const getTransactionSummary = asyncHandler(async (req, res) => {
  await ensureUserObligations(req.userId);
  await refreshUserObligationStatuses(req.userId);
  const now = new Date();
  const userSettings = await User.findById(req.userId).select("preferences.timezone").lean();
  const timeZone = normalizeFinanceTimeZone(userSettings?.preferences?.timezone);
  const dateRange = req.query.allTime === "true"
    ? null
    : resolveDateRange({
      ...req.query,
      month: req.query.month || now.getMonth() + 1,
      year: req.query.year || now.getFullYear()
    });
  const periodMatch = { userId: req.userId, status: "ACTIVE", ...(dateRange ? { transactionDate: dateRange } : {}) };
  const [accounts, periodTotals, personOutstanding, peopleOutstanding, currentObligations, periodSettlements, allTimeSettlements, settlementPersonalExpense] = await Promise.all([
    Account.find({ userId: req.userId, isActive: true, type: { $in: ["CASH", "BANK", "WALLET"] } }).select("currentBalance").lean(),
    Transaction.aggregate([
      {
        $match: {
          ...periodMatch,
          type: { $in: [...INCOME_TYPES, ...PERSONAL_EXPENSE_TYPES, ...SETTLEMENT_TYPES] }
        }
      },
      {
        $group: {
          _id: "$type",
          total: { $sum: "$amount" },
          personalAmount: { $sum: personalExpenseAmountExpression() }
        }
      }
    ]),
    Obligation.aggregate([
      {
        $match: { userId: req.userId, status: { $nin: ["SETTLED", "CANCELLED"] }, remainingAmount: { $gt: 0 } }
      },
      { $group: { _id: "$sourceType", total: { $sum: "$remainingAmount" } } }
    ]),
    Obligation.aggregate([
      { $match: { userId: req.userId, status: { $nin: ["SETTLED", "CANCELLED"] }, remainingAmount: { $gt: 0 } } },
      {
        $group: {
          _id: { person: "$person", direction: "$direction" },
          amount: { $sum: "$remainingAmount" },
          count: { $sum: 1 },
          breakdown: {
            $push: {
              _id: "$_id",
              sourceType: "$sourceType",
              remainingAmount: "$remainingAmount",
              settledAmount: "$settledAmount",
              originalAmount: "$originalAmount",
              status: "$status",
              dueDate: "$dueDate",
              sourceTransaction: "$sourceTransaction"
            }
          }
        }
      },
      {
        $lookup: {
          from: "people",
          let: { personId: "$_id.person", ownerId: req.userId },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ["$_id", "$$personId"] }, { $eq: ["$userId", "$$ownerId"] }] } } },
            { $project: { name: 1 } }
          ],
          as: "person"
        }
      },
      { $unwind: "$person" },
      {
        $lookup: {
          from: "transactions",
          let: { transactionIds: "$breakdown.sourceTransaction", ownerId: req.userId },
          pipeline: [
            { $match: { $expr: { $and: [{ $in: ["$_id", "$$transactionIds"] }, { $eq: ["$userId", "$$ownerId"] }] } } },
            { $project: { type: 1, note: 1, transactionDate: 1, transactionTime: 1 } }
          ],
          as: "sourceTransactions"
        }
      },
      {
        $project: {
          _id: 0,
          person: { _id: "$_id.person", name: "$person.name" },
          direction: "$_id.direction",
          amount: 1,
          count: 1,
          breakdown: {
            $map: {
              input: "$breakdown",
              as: "item",
              in: {
                _id: "$$item._id",
                sourceType: "$$item.sourceType",
                remainingAmount: "$$item.remainingAmount",
                settledAmount: "$$item.settledAmount",
                originalAmount: "$$item.originalAmount",
                status: "$$item.status",
                dueDate: "$$item.dueDate",
                sourceTransaction: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$sourceTransactions",
                        as: "source",
                        cond: { $eq: ["$$source._id", "$$item.sourceTransaction"] }
                      }
                    },
                    0
                  ]
                }
              }
            }
          }
        }
      },
      { $sort: { amount: -1 } }
    ]),
    Obligation.find({ userId: req.userId, status: { $nin: ["SETTLED", "CANCELLED"] }, remainingAmount: { $gt: 0 } })
      .select("direction dueDate remainingAmount settledAmount status")
      .lean(),
    Settlement.aggregate([
      { $match: { userId: req.userId, status: "ACTIVE", ...(dateRange ? { settlementDate: dateRange } : {}) } },
      { $group: { _id: "$direction", total: { $sum: { $ifNull: ["$totalAmount", "$amount"] } } } }
    ]),
    Settlement.aggregate([
      { $match: { userId: req.userId, status: "ACTIVE", direction: { $in: ["PAYMENT", "RECEIPT", "PAID_BY_ME", "RECEIVED_BY_ME"] } } },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$totalAmount", "$amount"] } } } }
    ]),
    payableSettlementExpenseSum(req.userId, dateRange, periodMatch)
  ]);

  const byType = periodTotals.reduce((acc, item) => ({ ...acc, [item._id]: item }), {});
  const outstandingTotals = summarizeOutstandingByType(personOutstanding);
  const classifiedPeopleOutstanding = peopleOutstanding.map((item) => ({
    ...item,
    breakdown: (item.breakdown || []).map((obligation) => ({
      ...obligation,
      ...classifyObligation(obligation, now, timeZone)
    }))
  }));
  const availableMoney = accounts.reduce((sum, account) => sum + Number(account.currentBalance || 0), 0);
  const dueTotals = {};
  let partialSettlementCount = 0;
  currentObligations.forEach((obligation) => {
    const classification = classifyObligation(obligation, now, timeZone);
    if (classification.settlementState === "PARTIAL") partialSettlementCount += 1;
    if (!["TODAY", "UPCOMING", "OVERDUE"].includes(classification.dateState)) return;
    if (!["PAYABLE", "RECEIVABLE"].includes(obligation.direction)) return;
    const key = `${obligation.direction.toLowerCase()}${classification.dateState[0]}${classification.dateState.slice(1).toLowerCase()}`;
    dueTotals[key] = Number((Number(dueTotals[key] || 0) + Number(obligation.remainingAmount || 0)).toFixed(2));
    dueTotals[`${key}Count`] = Number(dueTotals[`${key}Count`] || 0) + 1;
  });
  const settledAllTime = Number(allTimeSettlements[0]?.total || 0);
  const personalExpense = Number(personalExpenseValue(byType) || 0) + Number(settlementPersonalExpense || 0);
  const settlementTotals = periodSettlements.reduce((totals, item) => {
    if (["RECEIPT", "RECEIVED_BY_ME"].includes(item._id)) totals.received += Number(item.total || 0);
    if (["PAYMENT", "PAID_BY_ME"].includes(item._id)) totals.paid += Number(item.total || 0);
    return totals;
  }, { received: 0, paid: 0 });

  successResponse(
    res,
    {
      availableMoney,
      incomeThisMonth: incomeValue(byType),
      personalExpense,
      expenseThisMonth: personalExpense,
      ...outstandingTotals,
      peopleOutstanding: classifiedPeopleOutstanding,
      partialSettlementCount,
      settledAllTime,
      receivedBack: settlementTotals.received,
      paidBack: settlementTotals.paid,
      payableToday: dueTotals.payableToday || 0,
      payableUpcoming: dueTotals.payableUpcoming || 0,
      payableOverdue: dueTotals.payableOverdue || 0,
      receivableToday: dueTotals.receivableToday || 0,
      receivableUpcoming: dueTotals.receivableUpcoming || 0,
      receivableOverdue: dueTotals.receivableOverdue || 0,
      payableTodayCount: dueTotals.payableTodayCount || 0,
      payableUpcomingCount: dueTotals.payableUpcomingCount || 0,
      payableOverdueCount: dueTotals.payableOverdueCount || 0,
      receivableTodayCount: dueTotals.receivableTodayCount || 0,
      receivableUpcomingCount: dueTotals.receivableUpcomingCount || 0,
      receivableOverdueCount: dueTotals.receivableOverdueCount || 0
    },
    "Transaction summary fetched"
  );
});

export const settleTransaction = asyncHandler(async (req, res, next) => {
  if (!isValidId(req.params.id)) throw new ApiError("Invalid transaction id", 400);
  await ensureUserObligations(req.userId);
  await refreshUserObligationStatuses(req.userId);
  const obligation = await Obligation.findOne({ userId: req.userId, sourceTransaction: req.params.id });
  if (!obligation || obligation.remainingAmount <= 0 || ["SETTLED", "CANCELLED"].includes(obligation.status)) {
    throw new ApiError("Open obligation not found", 404);
  }
  req.body = { ...req.body, allocations: [{ obligationId: String(obligation._id), amount: req.body.amount }] };
  return createSettlement(req, res, next);
});

export const createSplitExpense = asyncHandler(async (req, res) => {
  const requestKey = requireRequestKey(req);
  if (await replayRequest(req, res, requestKey, "Split expense saved successfully.")) return;
  const session = await mongoose.startSession();

  try {
    const created = [];
    await session.withTransaction(async () => {
      const amount = parseAmount(req.body.amount);
      const myShare = Number(req.body.myShare || 0);
      const participants = Array.isArray(req.body.participants) ? req.body.participants : [];
      if (myShare < 0 || myShare > amount) throw new ApiError("Invalid personal share", 400);
      if (!participants.length) throw new ApiError("At least one split participant is required", 400);

      const splitTotal = participants.reduce((sum, item) => sum + Number(item.amount || 0), myShare);
      if (Math.abs(splitTotal - amount) > 0.01) throw new ApiError("Split amounts must equal total amount", 400);

      const splitGroupId = new mongoose.Types.ObjectId();
      const base = {
        account: req.body.account,
        category: req.body.category || undefined,
        tags: Array.isArray(req.body.tags) ? req.body.tags.filter(Boolean) : [],
        note: req.body.note || "",
        transactionDate: req.body.transactionDate,
        transactionTime: req.body.transactionTime,
        dueDate: req.body.dueDate || undefined,
        reminderEnabled: Boolean(req.body.reminderEnabled)
      };

      const splitPayload = {
        ...base,
        userId: req.userId,
        createdBy: req.userId,
        requestKey,
        type: "SPLIT_EXPENSE",
        amount,
        myShare,
        splitGroupId,
        splitParticipants: participants.map((item) => ({ person: item.person, amount: Number(item.amount) })),
        repaymentStatus: "NONE"
      };
      validateTransactionPayload({ ...splitPayload, type: "EXPENSE" });
      await assertOwnedReferences(splitPayload, req.userId, session);

      for (const participant of splitPayload.splitParticipants) {
        const person = await Person.findOne({ _id: participant.person, userId: req.userId, isActive: true }).session(session);
        if (!person) throw new ApiError("Split participant not found", 404);
      }

      const [split] = await Transaction.create([splitPayload], { session });
      await applyTransactionAccountEffects(split, req.userId, session, 1);
      await recordTransactionCreatedActivity({ transaction: split, userId: req.userId, session });
      created.push(split);

      for (const participant of splitPayload.splitParticipants) {
        const [owed] = await Transaction.create(
          [
            {
              ...base,
              userId: req.userId,
              createdBy: req.userId,
              requestKey,
              type: "PAID_FOR_SOMEONE",
              amount: participant.amount,
              person: participant.person,
              originalAmount: participant.amount,
              remainingAmount: participant.amount,
              repaymentStatus: "PENDING",
              splitGroupId,
              parentTransaction: split._id
            }
          ],
          { session }
        );
        const obligation = await createObligationForTransaction(owed, req.userId, session, "SPLIT_SHARE");
        await recordTransactionCreatedActivity({ transaction: owed, obligation, userId: req.userId, session });
        created.push(owed);
      }
      await recordRequest(req, requestKey, created, session);
    });

    const transactions = await populateQuery(Transaction.find({ _id: { $in: created.map((item) => item._id) } }));
    successResponse(res, transactions, "Split expense saved successfully.", 201);
  } catch (error) {
    if (error.code === 11000 && await replayRequest(req, res, requestKey, "Split expense saved successfully.")) return;
    throw error;
  } finally {
    await session.endSession();
  }
});

export const getPersonLedger = asyncHandler(async (req, res) => {
  await ensureUserObligations(req.userId);
  await refreshUserObligationStatuses(req.userId);
  if (!isValidId(req.params.id)) throw new ApiError("Invalid person id", 400);
  const person = await Person.findOne({ _id: req.params.id, userId: req.userId, isActive: true });
  if (!person) throw new ApiError("Person not found", 404);

  const userSettings = await User.findById(req.userId).select("preferences.timezone").lean();
  const timeZone = normalizeFinanceTimeZone(userSettings?.preferences?.timezone);
  const filters = buildFilters(req.query, req.userId);
  filters.person = req.params.id;
  filters.status = "ACTIVE";
  if (req.query.ledgerType === "to_receive") {
    filters.type = { $in: RECEIVABLE_TYPES };
    filters.repaymentStatus = { $in: OPEN_REPAYMENT_STATUSES };
    filters.remainingAmount = { $gt: 0 };
  }
  if (req.query.ledgerType === "to_pay") {
    filters.type = { $in: PAYABLE_TYPES };
    filters.repaymentStatus = { $in: OPEN_REPAYMENT_STATUSES };
    filters.remainingAmount = { $gt: 0 };
  }
  if (["borrowed", "loan"].includes(req.query.ledgerType)) filters.type = "BORROW";
  if (req.query.ledgerType === "lent") filters.type = "LEND";
  if (req.query.ledgerType === "paid_for_someone") filters.type = { $in: ["PAID_FOR_SOMEONE", "SPLIT_EXPENSE"] };
  if (req.query.ledgerType === "someone_paid_for_me") filters.type = "PAID_BY_SOMEONE";
  if (["open", "pending", "partial", "settled", "overdue", "overdue_payable", "overdue_receivable"].includes(req.query.balanceStatus)) {
    if (!filters.type) filters.type = { $in: [...PAYABLE_TYPES, ...RECEIVABLE_TYPES] };
  }
  if (req.query.balanceStatus === "open") {
    filters.repaymentStatus = { $in: OPEN_REPAYMENT_STATUSES };
    filters.remainingAmount = { $gt: 0 };
  }
  if (req.query.balanceStatus === "pending") {
    filters.repaymentStatus = "PENDING";
    filters.remainingAmount = { $gt: 0 };
  }
  if (req.query.balanceStatus === "partial") {
    filters.repaymentStatus = "PARTIAL";
    filters.remainingAmount = { $gt: 0 };
  }
  if (req.query.balanceStatus === "settled") {
    filters.repaymentStatus = "PAID";
    filters.remainingAmount = { $lte: 0 };
  }
  if (["overdue", "overdue_payable", "overdue_receivable"].includes(req.query.balanceStatus)) {
    filters.type = { $in: req.query.balanceStatus === "overdue_payable" ? PAYABLE_TYPES : req.query.balanceStatus === "overdue_receivable" ? RECEIVABLE_TYPES : [...PAYABLE_TYPES, ...RECEIVABLE_TYPES] };
    filters.remainingAmount = { $gt: 0 };
    filters.repaymentStatus = { $in: OPEN_REPAYMENT_STATUSES };
    Object.assign(filters, dueDateMatch("OVERDUE", timeZone));
    delete filters.transactionDate;
  }

  const transactions = await populateQuery(
    Transaction.find(filters).sort(sortOption(req.query.sort))
  );

  const obligationFilter = { userId: req.userId, person: req.params.id, status: { $ne: "CANCELLED" } };
  if (req.query.ledgerType === "history") delete obligationFilter.status;
  if (req.query.ledgerType === "to_receive") {
    obligationFilter.direction = "RECEIVABLE";
    obligationFilter.remainingAmount = { $gt: 0 };
    obligationFilter.status = { $nin: ["SETTLED", "CANCELLED"] };
  }
  if (req.query.ledgerType === "to_pay") {
    obligationFilter.direction = "PAYABLE";
    obligationFilter.remainingAmount = { $gt: 0 };
    obligationFilter.status = { $nin: ["SETTLED", "CANCELLED"] };
  }
  if (req.query.ledgerType === "borrowed" || req.query.ledgerType === "loan") {
    obligationFilter.sourceType = "BORROW";
    obligationFilter.direction = "PAYABLE";
  }
  if (req.query.ledgerType === "lent") obligationFilter.sourceType = "LEND";
  if (req.query.ledgerType === "paid_for_someone") obligationFilter.sourceType = { $in: ["PAID_FOR_SOMEONE", "SPLIT_SHARE"] };
  if (req.query.ledgerType === "someone_paid_for_me") obligationFilter.sourceType = "PAID_BY_SOMEONE";
  if (req.query.balanceStatus === "open") {
    obligationFilter.status = { $nin: ["SETTLED", "CANCELLED"] };
    obligationFilter.remainingAmount = { $gt: 0 };
  }
  if (req.query.balanceStatus === "pending") obligationFilter.status = { $in: ["PENDING", "OVERDUE"] };
  if (req.query.balanceStatus === "partial") obligationFilter.status = "PARTIALLY_SETTLED";
  if (req.query.balanceStatus === "settled") obligationFilter.status = "SETTLED";
  if (req.query.balanceStatus === "cancelled") obligationFilter.status = "CANCELLED";
  if (req.query.balanceStatus === "overdue") {
    obligationFilter.remainingAmount = { $gt: 0 };
    obligationFilter.status = { $nin: ["SETTLED", "CANCELLED"] };
    Object.assign(obligationFilter, dueDateMatch("OVERDUE", timeZone));
  }
  if (["overdue_payable", "overdue_receivable"].includes(req.query.balanceStatus)) {
    obligationFilter.direction = req.query.balanceStatus === "overdue_payable" ? "PAYABLE" : "RECEIVABLE";
    obligationFilter.status = { $nin: ["SETTLED", "CANCELLED"] };
    obligationFilter.remainingAmount = { $gt: 0 };
    Object.assign(obligationFilter, dueDateMatch("OVERDUE", timeZone));
  }
  if (req.query.startDate || req.query.endDate) {
    obligationFilter.createdAt = {
      ...(req.query.startDate ? { $gte: new Date(req.query.startDate) } : {}),
      ...(req.query.endDate ? { $lte: new Date(`${req.query.endDate}T23:59:59.999`) } : {})
    };
  }
  if (req.query.account) {
    if (!isValidId(req.query.account)) throw new ApiError("Invalid account id", 400);
    const sourceTransactions = await Transaction.find({
      userId: req.userId,
      person: req.params.id,
      account: req.query.account
    }).distinct("_id");
    const settlementsForAccount = await Settlement.find({ userId: req.userId, person: req.params.id, account: req.query.account }).distinct("_id");
    const settlementObligations = settlementsForAccount.length
      ? await SettlementAllocation.find({ userId: req.userId, settlement: { $in: settlementsForAccount } }).distinct("obligation")
      : [];
    const matchingObligations = await Obligation.find({
      userId: req.userId,
      person: req.params.id,
      $or: [
        { sourceTransaction: { $in: sourceTransactions } },
        { _id: { $in: settlementObligations } }
      ]
    }).distinct("_id");
    obligationFilter._id = { $in: matchingObligations };
  }
  const obligations = await Obligation.find(obligationFilter)
    .sort({ dueDate: 1, createdAt: -1 })
    .populate({ path: "sourceTransaction", match: { userId: req.userId }, select: "type amount note transactionDate transactionTime category account", populate: { path: "account", match: { userId: req.userId }, select: "name type" } });
  const obligationIds = obligations.map((item) => item._id);
  const allocations = await SettlementAllocation.find({ userId: req.userId, obligation: { $in: obligationIds } })
    .sort({ createdAt: 1 })
    .populate({ path: "settlement", match: { userId: req.userId }, populate: { path: "account", select: "name type" } });
  const events = await ObligationEvent.find({ userId: req.userId, obligation: { $in: obligationIds } }).sort({ createdAt: 1 });
  const historyByObligation = allocations.reduce((map, item) => {
    if (item.settlement) map.set(String(item.obligation), [...(map.get(String(item.obligation)) || []), item]);
    return map;
  }, new Map());
  const eventsByObligation = events.reduce((map, item) => map.set(String(item.obligation), [...(map.get(String(item.obligation)) || []), item]), new Map());
  const ledgerObligations = obligations.map((item) => ({
    ...item.toObject(),
    ...classifyObligation(item, new Date(), timeZone),
    settlements: historyByObligation.get(String(item._id)) || [],
    events: eventsByObligation.get(String(item._id)) || []
  }));
  const summaryObligations = await Obligation.find({ userId: req.userId, person: req.params.id, status: { $ne: "CANCELLED" } });
  const summary = summaryObligations.reduce((acc, item) => {
    const remaining = Number(item.remainingAmount || 0);
    const open = remaining > 0 && !["SETTLED", "CANCELLED"].includes(item.status);
    if (item.status === "SETTLED" || remaining <= 0) acc.settledAmount += Number(item.originalAmount || 0);
    if (open && item.direction === "RECEIVABLE") acc.totalToReceive += remaining;
    if (open && item.direction === "PAYABLE") acc.totalToPay += remaining;
    if (remaining > 0 && classifyObligation(item, new Date(), timeZone).dateState === "OVERDUE") {
      if (item.direction === "RECEIVABLE") acc.overdueReceivableAmount += remaining;
      if (item.direction === "PAYABLE") acc.overduePayableAmount += remaining;
    }
    return acc;
  }, { totalToReceive: 0, totalToPay: 0, netBalance: 0, pendingAmount: 0, settledAmount: 0, overdueReceivableAmount: 0, overduePayableAmount: 0 });
  ["totalToReceive", "totalToPay", "settledAmount", "overdueReceivableAmount", "overduePayableAmount"].forEach((key) => {
    summary[key] = Number(summary[key].toFixed(2));
  });
  summary.pendingAmount = Number((summary.totalToReceive + summary.totalToPay).toFixed(2));
  summary.netBalance = Number((summary.totalToReceive - summary.totalToPay).toFixed(2));

  successResponse(res, { person, summary, transactions, obligations: ledgerObligations }, "Person ledger fetched");
});
