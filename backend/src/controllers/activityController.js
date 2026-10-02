import mongoose from "mongoose";
import ActivityEvent from "../models/ActivityEvent.js";
import Person from "../models/Person.js";
import Category from "../models/Category.js";
import Tag from "../models/Tag.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { successResponse } from "../utils/apiResponse.js";
import { ensureActivityEventsForUser } from "../services/activityEventService.js";

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

function resolveActivityDateRange(query = {}) {
  const now = new Date();
  let start;
  let end;
  if (query.startDate || query.endDate) {
    start = query.startDate ? startOfDay(new Date(query.startDate)) : undefined;
    end = query.endDate ? endExclusive(new Date(query.endDate)) : undefined;
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

async function buildActivityFilters(query, userId) {
  const filters = { userId };
  const dateRange = resolveActivityDateRange(query);
  if (dateRange) filters.occurredAt = dateRange;
  if (query.person) filters.person = query.person;
  if (query.account) filters.account = query.account;
  if (query.category) filters.category = query.category;
  if (query.tag) filters.tags = query.tag;
  if (query.direction) filters.direction = String(query.direction).toUpperCase();
  if (query.status) filters.statusAfter = query.status;
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

function sortActivity(sort = "newest") {
  return ({
    oldest: { occurredAt: 1, createdAt: 1 },
    amount_high: { amount: -1, occurredAt: -1 },
    amount_low: { amount: 1, occurredAt: -1 },
    newest: { occurredAt: -1, createdAt: -1 }
  })[sort] || { occurredAt: -1, createdAt: -1 };
}

function populateActivity(query) {
  return query
    .populate("person", "name avatarColor")
    .populate("account", "name type")
    .populate("category", "name type color")
    .populate("tags", "name color")
    .populate({ path: "rootTransaction", select: "type amount originalAmount transactionDate transactionTime note destinationAccount", populate: { path: "destinationAccount", select: "name" } })
    .populate("transaction", "type amount originalAmount transactionDate transactionTime note")
    .populate("obligation", "sourceType direction originalAmount settledAmount remainingAmount status dueDate")
    .populate("settlement", "direction amount totalAmount settlementDate settlementTime note");
}

export const listActivityEvents = asyncHandler(async (req, res) => {
  await ensureActivityEventsForUser(req.userId);
  const filters = await buildActivityFilters(req.query, req.userId);
  const limit = Math.min(Number(req.query.limit || 1000), 2000);
  const events = await populateActivity(ActivityEvent.find(filters).sort(sortActivity(req.query.sort)).limit(limit));
  successResponse(res, events, "Activity events fetched");
});

export const getActivityEvent = asyncHandler(async (req, res) => {
  await ensureActivityEventsForUser(req.userId);
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new ApiError("Invalid activity event id", 400);
  const event = await populateActivity(ActivityEvent.findOne({ _id: req.params.id, userId: req.userId }));
  if (!event) throw new ApiError("Activity event not found", 404);
  successResponse(res, event, "Activity event fetched");
});
