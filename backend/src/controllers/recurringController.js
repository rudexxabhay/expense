import mongoose from "mongoose";
import Account from "../models/Account.js";
import Category from "../models/Category.js";
import Notification from "../models/Notification.js";
import RecurringRule from "../models/RecurringRule.js";
import Tag from "../models/Tag.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { successResponse } from "../utils/apiResponse.js";
import { countsAsIncome } from "../utils/financeRules.js";
import { applyTransactionAccountEffects } from "../services/accountingEngine.js";

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function zonedParts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map((item) => [item.type, Number(item.value)]));
}

function zonedDate(parts, timeZone) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
  let guess = desired;
  for (let i = 0; i < 2; i += 1) {
    const actual = zonedParts(new Date(guess), timeZone);
    guess += desired - Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
  }
  return new Date(guess);
}

function zonedStartOfDay(date, timeZone) {
  return zonedDate(zonedParts(date, timeZone), timeZone);
}

function zonedDateKey(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function dateKey(date) {
  return startOfDay(date).toISOString().slice(0, 10);
}

function addInterval(date, frequency, interval = 1) {
  const next = new Date(date);
  const step = Number(interval || 1);
  if (frequency === "DAILY" || frequency === "CUSTOM") next.setDate(next.getDate() + step);
  if (frequency === "WEEKLY") next.setDate(next.getDate() + step * 7);
  if (frequency === "MONTHLY") next.setMonth(next.getMonth() + step);
  if (frequency === "YEARLY") next.setFullYear(next.getFullYear() + step);
  return startOfDay(next);
}

function parseAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError("Amount must be greater than 0", 400);
  return amount;
}

async function assertOwnedRuleRefs(payload, userId) {
  const account = await Account.findOne({ _id: payload.account, userId, isActive: true });
  if (!account) throw new ApiError("Account not found", 404);
  if (payload.category) {
    const category = await Category.findOne({ _id: payload.category, userId, isActive: true });
    if (!category) throw new ApiError("Category not found", 404);
  }
  if (payload.tags?.length) {
    const tagCount = await Tag.countDocuments({ _id: { $in: payload.tags }, userId });
    if (tagCount !== payload.tags.length) throw new ApiError("One or more tags were not found", 404);
  }
}

function normalizeRule(body, userId) {
  const startDate = body.startDate ? startOfDay(new Date(body.startDate)) : startOfDay(new Date());
  return {
    userId,
    name: String(body.name || "").trim(),
    type: body.type,
    amount: parseAmount(body.amount),
    account: body.account,
    category: body.category || undefined,
    tags: Array.isArray(body.tags) ? body.tags.filter(Boolean) : [],
    note: body.note || "",
    frequency: body.frequency || "MONTHLY",
    interval: Number(body.interval || 1),
    startDate,
    nextRunDate: body.nextRunDate ? startOfDay(new Date(body.nextRunDate)) : startDate,
    endDate: body.endDate ? startOfDay(new Date(body.endDate)) : undefined,
    transactionTime: body.transactionTime || "09:00",
    reminderEnabled: Boolean(body.reminderEnabled),
    reminderStartDaysBefore: Number(body.reminderStartDaysBefore ?? 3),
    reminderTimes: Array.isArray(body.reminderTimes) && body.reminderTimes.length ? body.reminderTimes.slice(0, 3) : ["09:00", "14:00", "19:00"],
    isActive: body.isActive !== false
  };
}

async function createOccurrence(rule, runDate) {
  const recurrenceKey = dateKey(runDate);
  const session = await mongoose.startSession();
  let transaction;
  let insufficientAccount;
  try {
    await session.withTransaction(async () => {
      const existing = await Transaction.findOne({ userId: rule.userId, recurringRule: rule._id, recurrenceKey }).session(session);
      if (existing) return;
      [transaction] = await Transaction.create([{
        userId: rule.userId,
        createdBy: rule.userId,
        type: rule.type,
        amount: rule.amount,
        account: rule.account,
        category: rule.category,
        tags: rule.tags,
        note: rule.note || rule.name,
        transactionDate: runDate,
        transactionTime: rule.transactionTime || "09:00",
        status: "ACTIVE",
        repaymentStatus: "NONE",
        reminderEnabled: false,
        recurringRule: rule._id,
        recurrenceKey
      }], { session });
      await applyTransactionAccountEffects(transaction, rule.userId, session);
    });
  } catch (error) {
    if (error.code === 11000) return false;
    if (error.errors?.code !== "INSUFFICIENT_BALANCE") throw error;
    insufficientAccount = await Account.findOne({ _id: rule.account, userId: rule.userId });
    transaction = null;
  } finally {
    await session.endSession();
  }
  if (!transaction && !insufficientAccount) return false;
  if (insufficientAccount) {
    await Notification.updateOne(
      { userId: rule.userId, notificationKey: `recurring-failed:${rule._id}:${recurrenceKey}` },
      { $setOnInsert: {
        userId: rule.userId,
        notificationKey: `recurring-failed:${rule._id}:${recurrenceKey}`,
        recurringRule: rule._id,
        type: "RECURRING",
        title: `${rule.name} not created`,
        message: `Insufficient balance. Available: ₹${Number(insufficientAccount.currentBalance || 0).toLocaleString("en-IN")} · Required: ₹${Number(rule.amount || 0).toLocaleString("en-IN")}`,
        amount: rule.amount,
        dueDate: runDate,
        reminderAt: new Date(),
        direction: "NONE"
      } },
      { upsert: true }
    );
    return false;
  }

  await Notification.updateOne(
    { userId: rule.userId, notificationKey: `recurring:${rule._id}:${recurrenceKey}` },
    {
      $setOnInsert: {
        userId: rule.userId,
        notificationKey: `recurring:${rule._id}:${recurrenceKey}`,
        transaction: transaction._id,
        recurringRule: rule._id,
        type: "RECURRING",
        title: `${rule.name} created`,
        message: `${countsAsIncome(rule.type) ? "Income" : "Expense"} entry generated for ${recurrenceKey}`,
        amount: rule.amount,
        dueDate: runDate,
        reminderAt: new Date(),
        direction: "NONE"
      }
    },
    { upsert: true }
  );

  return true;
}

async function createRecurringReminder(rule, today, timeZone) {
  if (!rule.reminderEnabled) return;
  const dueDate = zonedStartOfDay(rule.nextRunDate, timeZone);
  const dueParts = zonedParts(dueDate, timeZone);
  const startParts = new Date(Date.UTC(dueParts.year, dueParts.month - 1, dueParts.day - Number(rule.reminderStartDaysBefore ?? 3)));
  const startDate = zonedDate({ year: startParts.getUTCFullYear(), month: startParts.getUTCMonth() + 1, day: startParts.getUTCDate() }, timeZone);
  if (today < startDate || today > dueDate) return;

  const todayParts = zonedParts(today, timeZone);
  const diff = Math.round((Date.UTC(dueParts.year, dueParts.month - 1, dueParts.day) - Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day)) / 86400000);
  const message = diff === 0 ? "Due today" : diff === 1 ? "Due tomorrow" : `Due in ${diff} days`;
  const times = Array.isArray(rule.reminderTimes) && rule.reminderTimes.length ? rule.reminderTimes : ["09:00", "14:00", "19:00"];
  const now = new Date();
  for (const time of times.slice(0, 3)) {
    const [hours, minutes] = time.split(":").map(Number);
    const reminderAt = zonedDate({ ...todayParts, hour: hours || 0, minute: minutes || 0, second: 0 }, timeZone);
    if (reminderAt > now) continue;
    await Notification.updateOne(
      { userId: rule.userId, notificationKey: `recurring-reminder:${rule._id}:${zonedDateKey(today, timeZone)}:${time}` },
      {
        $setOnInsert: {
          userId: rule.userId,
          notificationKey: `recurring-reminder:${rule._id}:${zonedDateKey(today, timeZone)}:${time}`,
          recurringRule: rule._id,
          type: "RECURRING",
          title: rule.name,
          message,
          amount: rule.amount,
          dueDate,
          reminderAt,
          direction: "NONE"
        }
      },
      { upsert: true }
    );
  }
}

export async function processRecurringRules(userId) {
  const user = await User.findById(userId).select("preferences.timezone");
  const timeZone = user?.preferences?.timezone || "Asia/Kolkata";
  const today = startOfDay(new Date());
  const reminderToday = zonedStartOfDay(new Date(), timeZone);
  const rules = await RecurringRule.find({
    userId,
    isActive: true,
    $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: today } }]
  });

  let generated = 0;
  for (const rule of rules) {
    await createRecurringReminder(rule, reminderToday, timeZone);
    if (startOfDay(rule.nextRunDate) > today) continue;
    let nextRunDate = startOfDay(rule.nextRunDate);
    let guard = 0;
    while (nextRunDate <= today && guard < 24) {
      if (!rule.endDate || nextRunDate <= startOfDay(rule.endDate)) {
        generated += (await createOccurrence(rule, nextRunDate)) ? 1 : 0;
      }
      nextRunDate = addInterval(nextRunDate, rule.frequency, rule.interval);
      guard += 1;
    }
    await RecurringRule.findOneAndUpdate({ _id: rule._id, userId }, { nextRunDate }, { runValidators: true });
  }
  return generated;
}

export const listRecurringRules = asyncHandler(async (req, res) => {
  const generated = await processRecurringRules(req.userId);
  const rules = await RecurringRule.find({ userId: req.userId, isActive: true })
    .sort({ nextRunDate: 1 })
    .populate("account", "name")
    .populate("category", "name color");
  successResponse(res, { rules, generated }, "Recurring rules fetched");
});

export const createRecurringRule = asyncHandler(async (req, res) => {
  const payload = normalizeRule(req.body, req.userId);
  if (!payload.name) throw new ApiError("Name is required", 400);
  if (!["INCOME", "EXPENSE"].includes(payload.type)) throw new ApiError("Recurring type must be income or expense", 400);
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "CUSTOM"].includes(payload.frequency)) throw new ApiError("Invalid frequency", 400);
  if (!payload.account || !isValidId(payload.account)) throw new ApiError("Valid account is required", 400);
  await assertOwnedRuleRefs(payload, req.userId);
  const rule = await RecurringRule.create(payload);
  successResponse(res, rule, "Recurring rule created", 201);
});

export const updateRecurringRule = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) throw new ApiError("Invalid recurring rule id", 400);
  const existing = await RecurringRule.findOne({ _id: req.params.id, userId: req.userId, isActive: true });
  if (!existing) throw new ApiError("Recurring rule not found", 404);
  const payload = normalizeRule({ ...existing.toObject(), ...req.body }, req.userId);
  await assertOwnedRuleRefs(payload, req.userId);
  const rule = await RecurringRule.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, payload, { new: true, runValidators: true });
  successResponse(res, rule, "Recurring rule updated");
});

export const deleteRecurringRule = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) throw new ApiError("Invalid recurring rule id", 400);
  const rule = await RecurringRule.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { isActive: false }, { new: true });
  if (!rule) throw new ApiError("Recurring rule not found", 404);
  successResponse(res, rule, "Recurring rule deactivated");
});

export const runRecurringRules = asyncHandler(async (req, res) => {
  const generated = await processRecurringRules(req.userId);
  successResponse(res, { generated }, "Recurring rules processed");
});
