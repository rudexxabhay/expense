import Notification from "../models/Notification.js";
import Obligation from "../models/Obligation.js";
import User from "../models/User.js";
import { ensureUserObligations, refreshUserObligationStatuses } from "../services/obligationService.js";
import { createSettlement } from "./obligationController.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { successResponse } from "../utils/apiResponse.js";
import { processRecurringRules } from "./recurringController.js";
import { deliverPush } from "../services/pushService.js";
import PushSubscription from "../models/PushSubscription.js";
import { classifyDateState, normalizeFinanceTimeZone } from "../utils/financeRules.js";

function localParts(date, timeZone) {
  const values = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(values.map((item) => [item.type, Number(item.value)]));
}

function fromLocal(parts, timeZone) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
  let guess = desired;
  for (let i = 0; i < 2; i += 1) {
    const actual = localParts(new Date(guess), timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += desired - represented;
  }
  return new Date(guess);
}

function startOfDay(date, timeZone) {
  return fromLocal(localParts(date, timeZone), timeZone);
}

function dateKey(date, timeZone) {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function dayDiff(a, b, timeZone) {
  const state = classifyDateState(a, b, timeZone);
  return state === "OVERDUE" ? -1 : state === "UPCOMING" ? 1 : 0;
}

function withTime(date, time, timeZone) {
  const [hours, minutes] = String(time || "09:00").split(":").map(Number);
  const p = localParts(date, timeZone);
  return fromLocal({ ...p, hour: hours || 0, minute: minutes || 0, second: 0 }, timeZone);
}

function notificationText(obligation, dueDate, today, timeZone) {
  const amount = Number(obligation.remainingAmount || 0);
  const person = obligation.person?.name || "Someone";
  const direction = obligation.direction === "RECEIVABLE" ? "RECEIVE" : "PAY";
  const diff = dayDiff(dueDate, today, timeZone);
  const amountText = `₹${amount.toLocaleString("en-IN")}`;
  const dateText = new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short" }).format(dueDate);
  const title = diff < 0 ? (direction === "RECEIVE" ? "Receivable overdue" : "Payment overdue")
    : diff === 0 ? (direction === "RECEIVE" ? "Money expected today" : "Payment due today")
      : direction === "RECEIVE" ? "Upcoming receivable" : "Upcoming payment";
  const message = diff < 0
    ? direction === "RECEIVE" ? `${amountText} from ${person} is overdue.` : `You still need to pay ${person} ${amountText}.`
    : diff === 0
      ? direction === "RECEIVE" ? `You should receive ${amountText} from ${person} today.` : `You need to pay ${person} ${amountText} today.`
      : direction === "RECEIVE" ? `You should receive ${amountText} from ${person} on ${dateText}.` : `You need to pay ${person} ${amountText} on ${dateText}.`;
  const templateKey = diff < 0 ? `${direction}_OVERDUE` : diff === 0 ? `${direction}_DUE_TODAY` : `${direction}_UPCOMING`;
  const type = diff < 0 ? "OVERDUE" : diff === 0 ? "DUE_TODAY" : direction === "RECEIVE" ? "TO_RECEIVE" : "TO_PAY";
  return { title, message, type, direction, amount, templateKey };
}

async function upsertNotification(payload) {
  const { userId, notificationKey, ...fields } = payload;
  const { deliveryStatus, scheduledFor, ...mutableFields } = fields;
  await Notification.updateOne(
    { userId, notificationKey },
    { $setOnInsert: { userId, notificationKey, deliveryStatus, scheduledFor }, $set: mutableFields },
    { upsert: true }
  );
}

export async function processDueNotifications(userId) {
  const user = await User.findById(userId).select("preferences.timezone");
  const timeZone = normalizeFinanceTimeZone(user?.preferences?.timezone);
  await ensureUserObligations(userId);
  await refreshUserObligationStatuses(userId);
  const now = new Date();
  const today = startOfDay(now, timeZone);
  const items = await Obligation.find({
    userId,
    status: { $nin: ["SETTLED", "CANCELLED"] },
    remainingAmount: { $gt: 0 },
    dueDate: { $exists: true, $ne: null }
  }).populate("person", "name")
    .populate("sourceTransaction", "reminderEnabled reminderStartDaysBefore reminderTimes");
  const reminders = items.filter((item) => item.sourceTransaction?.reminderEnabled);

  await Notification.updateMany(
    {
      userId,
      obligation: { $exists: true, $nin: reminders.map((item) => item._id) },
      status: "UNREAD",
      reminderAt: { $gte: now }
    },
    { $set: { status: "ARCHIVED", deliveryStatus: "CANCELLED" } }
  );

  for (const item of reminders) {
    await Notification.updateMany(
      {
        userId,
        obligation: item._id,
        status: "UNREAD",
        dueDate: { $ne: startOfDay(item.dueDate, timeZone) },
        reminderAt: { $gte: now }
      },
      { $set: { status: "ARCHIVED", deliveryStatus: "CANCELLED" } }
    );
    const dueDate = startOfDay(item.dueDate, timeZone);
    const dueParts = localParts(dueDate, timeZone);
    const startParts = new Date(Date.UTC(dueParts.year, dueParts.month - 1, dueParts.day - Number(item.sourceTransaction?.reminderStartDaysBefore ?? 3)));
    const startDate = fromLocal({ year: startParts.getUTCFullYear(), month: startParts.getUTCMonth() + 1, day: startParts.getUTCDate(), hour: 0, minute: 0, second: 0 }, timeZone);
    if (today < startDate) continue;

    const text = notificationText(item, dueDate, today, timeZone);
    const times = Array.isArray(item.sourceTransaction?.reminderTimes) && item.sourceTransaction.reminderTimes.length ? item.sourceTransaction.reminderTimes : ["09:00", "14:00", "20:00"];

    if (text.templateKey.endsWith("_OVERDUE")) {
      await upsertNotification({
        userId,
        notificationKey: `overdue:${item._id}:${dateKey(dueDate, timeZone)}:v${item.version}`,
        transaction: item.sourceTransaction?._id,
        obligation: item._id,
        person: item.person?._id,
        personId: item.person?._id,
        templateKey: text.templateKey,
        type: "OVERDUE",
        title: text.title,
        message: text.message,
        amount: text.amount,
        remainingAmount: text.amount,
        dueDate,
        reminderAt: now,
        direction: text.direction,
        deliveryStatus: "SCHEDULED",
        scheduledFor: now
      });
      continue;
    }

    const scheduledTimes = times.slice(0, 3);
    const pastTimes = scheduledTimes.filter((time) => withTime(today, time, timeZone) <= now);
    const existingToday = await Notification.exists({
      userId,
      obligation: item._id,
      dueDate,
      notificationKey: { $regex: `^due:${item._id}:${dateKey(today, timeZone)}:` },
      status: { $ne: "ARCHIVED" }
    });
    if (pastTimes.length === scheduledTimes.length && !existingToday) {
      const reminderAt = now;
      await upsertNotification({
        userId,
        notificationKey: `due-catchup:${item._id}:${dateKey(today, timeZone)}:v${item.version}`,
        transaction: item.sourceTransaction?._id,
        obligation: item._id,
        person: item.person?._id,
        personId: item.person?._id,
        templateKey: text.templateKey,
        type: text.type,
        title: text.title,
        message: text.message,
        amount: text.amount,
        remainingAmount: text.amount,
        dueDate,
        reminderAt,
        direction: text.direction,
        deliveryStatus: "SCHEDULED",
        scheduledFor: reminderAt
      });
      continue;
    }

    for (const time of scheduledTimes) {
      const reminderAt = withTime(today, time, timeZone);
      if (reminderAt > now) continue;
      await upsertNotification({
        userId,
        notificationKey: `due:${item._id}:${dateKey(today, timeZone)}:${time}:v${item.version}`,
        transaction: item.sourceTransaction?._id,
        obligation: item._id,
        person: item.person?._id,
        personId: item.person?._id,
        templateKey: text.templateKey,
        type: text.type,
        title: text.title,
        message: text.message,
        amount: text.amount,
        remainingAmount: text.amount,
        dueDate,
        reminderAt,
        direction: text.direction,
        deliveryStatus: "SCHEDULED",
        scheduledFor: reminderAt
      });
    }
  }
}

export async function processScheduledNotifications() {
  const userIds = await User.distinct("_id");
  for (const id of userIds) {
    try {
      await processRecurringRules(String(id));
      await processDueNotifications(String(id));
      const pending = await Notification.find({ userId: String(id), reminderAt: { $lte: new Date() }, status: { $nin: ["ARCHIVED", "READ"] }, $or: [{ deliveryStatus: { $in: ["SCHEDULED", "PUSH_FAILED"] } }, { deliveryStatus: "PROCESSING", updatedAt: { $lt: new Date(Date.now() - 5 * 60_000) } }] }).limit(100);
      for (const notification of pending) {
        const claim = await Notification.updateOne({ _id: notification._id, status: { $nin: ["ARCHIVED", "READ"] }, $or: [{ deliveryStatus: { $in: ["SCHEDULED", "PUSH_FAILED"] } }, { deliveryStatus: "PROCESSING", updatedAt: { $lt: new Date(Date.now() - 5 * 60_000) } }] }, { $set: { deliveryStatus: "PROCESSING" }, $inc: { attempts: 1 } });
        if (!claim.modifiedCount) continue;
        if (notification.obligation) {
          const obligation = await Obligation.findOne({ _id: notification.obligation, userId: String(id) }).populate("person", "name");
          if (!obligation || obligation.remainingAmount <= 0 || ["SETTLED", "CANCELLED"].includes(obligation.status)) {
            await Notification.updateOne({ _id: notification._id }, { $set: { deliveryStatus: "CANCELLED", status: "ARCHIVED" } });
            continue;
          }
          const user = await User.findById(id).select("preferences.timezone");
          const timeZone = user?.preferences?.timezone || "Asia/Kolkata";
          const current = notificationText(obligation, obligation.dueDate || notification.dueDate, new Date(), timeZone);
          notification.title = current.title;
          notification.message = current.message;
          notification.amount = current.amount;
          notification.remainingAmount = current.amount;
          notification.templateKey = current.templateKey;
          notification.personId = obligation.person?._id;
          await notification.save();
        }
        const outcome = await deliverPush(notification);
        const update = { $addToSet: { deliveredDevices: { $each: outcome.deliveredDeviceIds || [] } } };
        update.$set = outcome.failed ? { deliveryStatus: "PUSH_FAILED" } : { deliveryStatus: "PUSH_SENT", sentAt: new Date() };
        await Notification.updateOne({ _id: notification._id }, update);
      }
    } catch (error) {
      console.error("[reminders] user processing failed", { name: error.name, code: error.code, message: error.message });
    }
  }
}

function filterMatch(filter) {
  if (filter === "due_today_pay") return { type: "DUE_TODAY", direction: "PAY" };
  if (filter === "due_today_receive") return { type: "DUE_TODAY", direction: "RECEIVE" };
  if (filter === "upcoming_pay") return { type: "TO_PAY", direction: "PAY" };
  if (filter === "upcoming_receive") return { type: "TO_RECEIVE", direction: "RECEIVE" };
  if (filter === "overdue_pay") return { type: "OVERDUE", direction: "PAY" };
  if (filter === "overdue_receive") return { type: "OVERDUE", direction: "RECEIVE" };
  if (filter === "to_receive") return { direction: "RECEIVE" };
  if (filter === "to_pay") return { direction: "PAY" };
  return {};
}

export const listNotifications = asyncHandler(async (req, res) => {
  await processRecurringRules(req.userId);
  await processDueNotifications(req.userId);
  const query = { userId: req.userId, status: { $ne: "ARCHIVED" }, ...filterMatch(req.query.filter) };
  const notifications = await Notification.find(query)
    .sort({ status: -1, dueDate: 1, createdAt: -1 })
    .limit(80)
    .populate({ path: "transaction", match: { userId: req.userId }, select: "type amount remainingAmount repaymentStatus dueDate" })
    .populate({ path: "obligation", match: { userId: req.userId }, select: "direction remainingAmount status dueDate person", populate: { path: "person", match: { userId: req.userId }, select: "name" } })
    .populate({ path: "personId", match: { userId: req.userId }, select: "name" })
    .populate({ path: "person", match: { userId: req.userId }, select: "name" })
    .populate("recurringRule", "name frequency amount");
  const unreadCount = await Notification.countDocuments({ userId: req.userId, status: "UNREAD" });
  const localized = notifications.map((item) => {
    const obligation = item.obligation;
    if (!obligation) {
      return { ...item.toObject(), title: "Reminder", message: "An older reminder is available. Open your obligations to review current details." };
    }
    if (obligation.status === "SETTLED" || obligation.status === "CANCELLED" || obligation.remainingAmount <= 0) {
      return { ...item.toObject(), title: obligation.direction === "RECEIVABLE" ? "Receivable settled" : "Payment settled", message: "This obligation has been settled." };
    }
    if (!(obligation.dueDate || item.dueDate)) return { ...item.toObject(), title: "Reminder", message: "Open your obligations to review the latest details." };
    const timeZone = req.user.preferences?.timezone || "Asia/Kolkata";
    const current = notificationText({ direction: obligation.direction, remainingAmount: obligation.remainingAmount, person: obligation.person || item.personId || item.person }, obligation.dueDate || item.dueDate, new Date(), timeZone);
    return { ...item.toObject(), title: current.title, message: current.message, amount: obligation.remainingAmount, remainingAmount: obligation.remainingAmount };
  });
  successResponse(res, { notifications: localized, unreadCount }, "Notifications fetched");
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { status: "READ", deliveryStatus: "READ", readAt: new Date() },
    { new: true }
  );
  if (!notification) throw new ApiError("Notification not found", 404);
  successResponse(res, notification, "Notification marked read");
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const readAt = new Date();
  await Notification.updateMany({ userId: req.userId, status: "UNREAD" }, { $set: { status: "READ", deliveryStatus: "READ", readAt } });
  successResponse(res, { ok: true }, "Notifications marked read");
});

export const archiveNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { status: "ARCHIVED" },
    { new: true }
  );
  if (!notification) throw new ApiError("Notification not found", 404);
  successResponse(res, notification, "Notification archived");
});

export const pushConfig = asyncHandler(async (req, res) => {
  successResponse(res, { publicKey: process.env.VAPID_PUBLIC_KEY || "", configured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT) }, "Push configuration fetched");
});

export const savePushSubscription = asyncHandler(async (req, res) => {
  const subscription = req.body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) throw new ApiError("Invalid push subscription", 400);
  const record = await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    { $set: { userId: req.userId, endpoint: subscription.endpoint, keys: subscription.keys, deviceLabel: req.body.deviceLabel || "", isActive: true, lastUsedAt: new Date() } },
    { upsert: true, new: true, runValidators: true }
  );
  successResponse(res, { id: record._id, isActive: record.isActive }, "Push subscription saved");
});

export const removePushSubscription = asyncHandler(async (req, res) => {
  const { endpoint } = req.body || {};
  await PushSubscription.updateOne({ userId: req.userId, endpoint }, { $set: { isActive: false } });
  successResponse(res, { ok: true }, "Push subscription removed");
});

export const pushStatus = asyncHandler(async (req, res) => {
  const activeDevices = await PushSubscription.countDocuments({ userId: req.userId, isActive: true });
  successResponse(res, { activeDevices, configured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT) }, "Push status fetched");
});

export const completeNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({ _id: req.params.id, userId: req.userId });
  if (!notification) throw new ApiError("Notification not found", 404);
  await ensureUserObligations(req.userId);
  await refreshUserObligationStatuses(req.userId);
  const obligation = notification.obligation
    ? await Obligation.findOne({ _id: notification.obligation, userId: req.userId })
    : notification.transaction
      ? await Obligation.findOne({ sourceTransaction: notification.transaction, userId: req.userId })
      : null;
  if (!obligation || obligation.remainingAmount <= 0 || obligation.status === "CANCELLED") {
    notification.status = "ARCHIVED";
    await notification.save();
    successResponse(res, notification, "Notification completed");
    return;
  }
  req.headers["idempotency-key"] = `notification-complete:${notification._id}`;
  req.body = {
    account: req.body.account,
    note: "Settled from notification",
    allocations: [{ obligationId: String(obligation._id), amount: Number(obligation.remainingAmount) }]
  };
  return createSettlement(req, res);
});
