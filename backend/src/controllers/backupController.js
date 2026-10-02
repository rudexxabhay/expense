import { createHash } from "node:crypto";
import Account from "../models/Account.js";
import Budget from "../models/Budget.js";
import Category from "../models/Category.js";
import Notification from "../models/Notification.js";
import Person from "../models/Person.js";
import QuickAddPreset from "../models/QuickAddPreset.js";
import RecurringRule from "../models/RecurringRule.js";
import ActivityEvent from "../models/ActivityEvent.js";
import Obligation from "../models/Obligation.js";
import ObligationEvent from "../models/ObligationEvent.js";
import SettlementAllocation from "../models/SettlementAllocation.js";
import Settlement from "../models/Settlement.js";
import Tag from "../models/Tag.js";
import Transaction from "../models/Transaction.js";
import TransactionAudit from "../models/TransactionAudit.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { successResponse } from "../utils/apiResponse.js";

const BACKUP_VERSION = 1;
const EXPORT_MODELS = {
  accounts: Account,
  people: Person,
  categories: Category,
  tags: Tag,
  transactions: Transaction,
  obligations: Obligation,
  settlements: Settlement,
  settlementAllocations: SettlementAllocation,
  obligationEvents: ObligationEvent,
  activityEvents: ActivityEvent,
  transactionAudits: TransactionAudit,
  notifications: Notification,
  recurringRules: RecurringRule,
  budgets: Budget,
  quickAddPresets: QuickAddPreset
};

function backupChecksum(backup) {
  return createHash("sha256")
    .update(JSON.stringify({ version: backup.version, exportedAt: backup.exportedAt, user: backup.user, data: backup.data }))
    .digest("hex");
}

function stripDoc(doc) {
  const item = doc.toObject ? doc.toObject() : { ...doc };
  delete item.__v;
  delete item.userId;
  return item;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function resolveTransactionDateFilter(query) {
  const filter = {};
  if (query.startDate || query.endDate) {
    filter.transactionDate = {};
    if (query.startDate) filter.transactionDate.$gte = startOfDay(new Date(query.startDate));
    if (query.endDate) {
      const end = startOfDay(new Date(query.endDate));
      end.setDate(end.getDate() + 1);
      filter.transactionDate.$lt = end;
    }
  }
  if (query.type) filter.type = query.type;
  if (query.account) filter.account = query.account;
  if (query.person) filter.person = query.person;
  if (query.category) filter.category = query.category;
  if (query.tag) filter.tags = query.tag;
  return filter;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const exportTransactionsCsv = asyncHandler(async (req, res) => {
  const query = { userId: req.userId, ...resolveTransactionDateFilter(req.query) };
  const rows = await Transaction.find(query)
    .sort({ transactionDate: -1, transactionTime: -1 })
    .populate("account", "name")
    .populate("destinationAccount", "name")
    .populate("person", "name")
    .populate("category", "name")
    .populate("tags", "name");

  const headers = ["date", "time", "type", "amount", "account", "destinationAccount", "person", "category", "tags", "status", "repaymentStatus", "remainingAmount", "dueDate", "note"];
  const lines = [
    headers.join(","),
    ...rows.map((item) => [
      item.transactionDate?.toISOString?.().slice(0, 10),
      item.transactionTime,
      item.type,
      item.amount,
      item.account?.name,
      item.destinationAccount?.name,
      item.person?.name,
      item.category?.name,
      item.tags?.map((tag) => tag.name).join("|"),
      item.status,
      item.repaymentStatus,
      item.remainingAmount,
      item.dueDate?.toISOString?.().slice(0, 10),
      item.note
    ].map(csvEscape).join(","))
  ];

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=transactions.csv");
  res.send(lines.join("\n"));
});

export const exportFullBackup = asyncHandler(async (req, res) => {
  const data = {};
  await Promise.all(Object.entries(EXPORT_MODELS).map(async ([key, Model]) => {
    data[key] = (await Model.find({ userId: req.userId })).map(stripDoc);
  }));

  const backup = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    user: {
      name: req.user.name,
      email: req.user.email,
      preferences: req.user.preferences
    },
    data
  };
  backup.integrity = { algorithm: "sha256", checksum: backupChecksum(backup) };

  successResponse(
    res,
    backup,
    "Backup exported"
  );
});

function validateBackupShape(backup) {
  if (!backup || typeof backup !== "object") throw new ApiError("Invalid backup file", 400);
  if (backup.version !== BACKUP_VERSION) throw new ApiError("Unsupported backup version", 400);
  if (!backup.data || typeof backup.data !== "object") throw new ApiError("Backup data is missing", 400);
  Object.keys(EXPORT_MODELS).forEach((key) => {
    if (backup.data[key] && !Array.isArray(backup.data[key])) {
      throw new ApiError(`Invalid ${key} collection`, 400);
    }
  });
  if (backup.integrity) {
    if (backup.integrity.algorithm !== "sha256" || backup.integrity.checksum !== backupChecksum(backup)) {
      throw new ApiError("Backup integrity check failed", 400);
    }
  }
}

function backupSummary(backup) {
  validateBackupShape(backup);
  return Object.keys(EXPORT_MODELS).reduce((summary, key) => {
    summary[key] = Array.isArray(backup.data[key]) ? backup.data[key].length : 0;
    return summary;
  }, {});
}

export const previewImport = asyncHandler(async (req, res) => {
  const summary = backupSummary(req.body);
  successResponse(res, { version: req.body.version, summary }, "Backup preview ready");
});

function cleanImportDoc(doc, userId) {
  const next = { ...doc, userId };
  delete next._id;
  delete next.id;
  delete next.__v;
  delete next.password;
  delete next.passwordHash;
  delete next.token;
  return next;
}

async function insertWithoutDuplicates(Model, docs, userId, duplicateQuery) {
  let created = 0;
  let skipped = 0;
  for (const doc of docs || []) {
    const item = cleanImportDoc(doc, userId);
    const exists = duplicateQuery ? await Model.findOne(duplicateQuery(item)) : null;
    if (exists) {
      skipped += 1;
      continue;
    }
    await Model.create(item);
    created += 1;
  }
  return { created, skipped };
}

async function hasOwned(Model, id, userId) {
  if (!id) return true;
  return Boolean(await Model.exists({ _id: id, userId }));
}

async function insertOwnedTransactions(docs, userId) {
  let created = 0;
  let skipped = 0;
  for (const doc of docs || []) {
    const item = cleanImportDoc(doc, userId);
    const refsOk = await hasOwned(Account, item.account, userId)
      && await hasOwned(Account, item.destinationAccount, userId)
      && await hasOwned(Person, item.person, userId)
      && await hasOwned(Category, item.category, userId);
    if (!refsOk) {
      skipped += 1;
      continue;
    }
    const exists = await Transaction.findOne({
      userId,
      type: item.type,
      amount: item.amount,
      transactionDate: item.transactionDate,
      transactionTime: item.transactionTime,
      note: item.note
    });
    if (exists) {
      skipped += 1;
      continue;
    }
    await Transaction.create(item);
    created += 1;
  }
  return { created, skipped };
}

async function insertOwnedBudgets(docs, userId) {
  let created = 0;
  let skipped = 0;
  for (const doc of docs || []) {
    const item = cleanImportDoc(doc, userId);
    if (!(await hasOwned(Category, item.category, userId))) {
      skipped += 1;
      continue;
    }
    const exists = await Budget.findOne({ userId, category: item.category, month: item.month, year: item.year });
    if (exists) {
      skipped += 1;
      continue;
    }
    await Budget.create(item);
    created += 1;
  }
  return { created, skipped };
}

async function insertOwnedRecurring(docs, userId) {
  let created = 0;
  let skipped = 0;
  for (const doc of docs || []) {
    const item = cleanImportDoc(doc, userId);
    const refsOk = await hasOwned(Account, item.account, userId) && await hasOwned(Category, item.category, userId);
    if (!refsOk) {
      skipped += 1;
      continue;
    }
    const exists = await RecurringRule.findOne({ userId, name: item.name, amount: item.amount, frequency: item.frequency });
    if (exists) {
      skipped += 1;
      continue;
    }
    await RecurringRule.create(item);
    created += 1;
  }
  return { created, skipped };
}

async function insertOwnedSettlements(docs, userId) {
  let created = 0;
  let skipped = 0;
  for (const doc of docs || []) {
    const item = cleanImportDoc(doc, userId);
    const refsOk = await hasOwned(Person, item.person, userId)
      && await hasOwned(Transaction, item.sourceTransaction, userId)
      && await hasOwned(Transaction, item.repaymentTransaction, userId)
      && await hasOwned(Account, item.account, userId);
    if (!refsOk) {
      skipped += 1;
      continue;
    }
    await Settlement.create(item);
    created += 1;
  }
  return { created, skipped };
}

async function insertOwnedNotifications(docs, userId) {
  let created = 0;
  let skipped = 0;
  for (const doc of docs || []) {
    const item = cleanImportDoc(doc, userId);
    const refsOk = await hasOwned(Transaction, item.transaction, userId)
      && await hasOwned(RecurringRule, item.recurringRule, userId);
    if (!refsOk) {
      skipped += 1;
      continue;
    }
    const exists = await Notification.findOne({ userId, notificationKey: item.notificationKey });
    if (exists) {
      skipped += 1;
      continue;
    }
    await Notification.create(item);
    created += 1;
  }
  return { created, skipped };
}

export const restoreBackup = asyncHandler(async (req, res) => {
  if (req.query.confirm !== "true" && req.body.confirm !== true) {
    throw new ApiError("Import confirmation is required", 400);
  }
  validateBackupShape(req.body.backup || req.body);
  const backup = req.body.backup || req.body;
  const data = backup.data;

  const result = {};
  result.accounts = await insertWithoutDuplicates(Account, data.accounts, req.userId, (item) => ({ userId: req.userId, name: item.name, type: item.type }));
  result.people = await insertWithoutDuplicates(Person, data.people, req.userId, (item) => ({ userId: req.userId, name: item.name }));
  result.categories = await insertWithoutDuplicates(Category, data.categories, req.userId, (item) => ({ userId: req.userId, name: item.name, type: item.type }));
  result.tags = await insertWithoutDuplicates(Tag, data.tags, req.userId, (item) => ({ userId: req.userId, name: item.name }));
  result.budgets = await insertOwnedBudgets(data.budgets, req.userId);
  result.quickAddPresets = await insertWithoutDuplicates(QuickAddPreset, data.quickAddPresets, req.userId, (item) => ({ userId: req.userId, name: item.name }));
  result.recurringRules = await insertOwnedRecurring(data.recurringRules, req.userId);
  result.transactions = await insertOwnedTransactions(data.transactions, req.userId);
  result.settlements = await insertOwnedSettlements(data.settlements, req.userId);
  result.notifications = await insertOwnedNotifications(data.notifications, req.userId);

  successResponse(res, result, "Backup imported");
});
