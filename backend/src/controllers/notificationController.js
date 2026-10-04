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

const DEFAULT_REMINDER_TIMES = ["09:00", "14:00", "19:00"];
const MAX_DELIVERY_ATTEMPTS = 3;

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
  const parts = localParts(date, timeZone);
  return fromLocal({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone);
}

function dateKey(date, timeZone) {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function dayDiff(a, b, timeZone) {
  const aParts = localParts(a, timeZone);
  const bParts = localParts(b, timeZone);
  const aUtc = Date.UTC(aParts.year, aParts.month - 1, aParts.day);
  const bUtc = Date.UTC(bParts.year, bParts.month - 1, bParts.day);
  return Math.round((aUtc - bUtc) / 86_400_000);
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
  const dateText = new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(dueDate);
  const relative = diff === 1 ? "tomorrow" : diff > 1 ? `in ${diff} days` : "today";
  const title = diff < 0
    ? direction === "RECEIVE" ? "Payment not received" : "Payment overdue"
    : diff === 0
      ? direction === "RECEIVE" ? "Payment expected today" : "Payment due today"
      : direction === "RECEIVE" ? "Payment expected soon" : "Payment due soon";
  const message = diff < 0
    ? direction === "RECEIVE" ? `${amountText} expected from ${person} is overdue.` : `${amountText} payment to ${person} is overdue.`
    : diff === 0
      ? direction === "RECEIVE" ? `${amountText} is expected from ${person} today.` : `${amountText} payment to ${person} is due today.`
      : direction === "RECEIVE" ? `${amountText} is expected from ${person} ${relative}, on ${dateText}.` : `${amountText} payment to ${person} is due ${relative}, on ${dateText}.`;
  const templateKey = diff < 0 ? `${direction}_OVERDUE` : diff === 0 ? `${direction}_DUE_TODAY` : `${direction}_DUE_SOON`;
  const type = diff < 0
    ? direction === "RECEIVE" ? "RECEIVABLE_OVERDUE" : "PAYMENT_OVERDUE"
    : diff === 0
      ? direction === "RECEIVE" ? "RECEIVABLE_DUE_TODAY" : "PAYMENT_DUE_TODAY"
      : direction === "RECEIVE" ? "RECEIVABLE_DUE_SOON" : "PAYMENT_DUE_SOON";
  return { title, message, type, direction, amount, templateKey };
}

async function upsertNotification(payload) {
  const { userId, notificationKey, ...fields } = payload;
  const { deliveryStatus, scheduledFor, ...mutableFields } = fields;
  const aliases = {
    ...(mutableFields.transaction ? { transactionId: mutableFields.transaction, sourceTransactionId: mutableFields.transaction } : {}),
    ...(mutableFields.obligation ? { obligationId: mutableFields.obligation } : {}),
    body: mutableFields.message,
    dedupeKey: mutableFields.dedupeKey || notificationKey,
    deepLink: mutableFields.deepLink || (mutableFields.obligation ? `/obligations/${mutableFields.obligation}` : "/home")
  };
  await Notification.updateOne(
    { userId, notificationKey },
    { $setOnInsert: { userId, notificationKey, deliveryStatus, scheduledFor }, $set: { ...mutableFields, ...aliases } },
    { upsert: true }
  );
}

function notificationPreferences(user = {}) {
  return {
    pushEnabled: user.preferences?.notifications?.pushEnabled !== false,
    paymentReminders: user.preferences?.notifications?.paymentReminders !== false,
    receivableReminders: user.preferences?.notifications?.receivableReminders !== false,
    overdueReminders: user.preferences?.notifications?.overdueReminders !== false,
    settlementConfirmations: user.preferences?.notifications?.settlementConfirmations !== false,
    recurringReminders: user.preferences?.notifications?.recurringReminders !== false,
    reminderStartDaysBefore: Number(user.preferences?.notifications?.reminderStartDaysBefore ?? 3),
    reminderTimes: Array.isArray(user.preferences?.notifications?.reminderTimes) && user.preferences.notifications.reminderTimes.length
      ? user.preferences.notifications.reminderTimes.slice(0, 3)
      : DEFAULT_REMINDER_TIMES,
    preview: user.preferences?.notifications?.preview === "PRIVATE" ? "PRIVATE" : "DETAILED"
  };
}

export async function processDueNotifications(userId) {
  const user = await User.findById(userId).select("preferences");
  const timeZone = normalizeFinanceTimeZone(user?.preferences?.timezone);
  const prefs = notificationPreferences(user);
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
  const reminders = items;

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
    const payable = item.direction === "PAYABLE";
    if (payable && !prefs.paymentReminders) continue;
    if (!payable && !prefs.receivableReminders) continue;
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
    const startDaysBefore = Number(item.sourceTransaction?.reminderStartDaysBefore ?? prefs.reminderStartDaysBefore ?? 3);
    const startParts = new Date(Date.UTC(dueParts.year, dueParts.month - 1, dueParts.day - startDaysBefore));
    const startDate = fromLocal({ year: startParts.getUTCFullYear(), month: startParts.getUTCMonth() + 1, day: startParts.getUTCDate(), hour: 0, minute: 0, second: 0 }, timeZone);
    if (today < startDate) continue;

    const text = notificationText(item, dueDate, today, timeZone);
    if (text.type.endsWith("_OVERDUE") && !prefs.overdueReminders) continue;
    const times = Array.isArray(item.sourceTransaction?.reminderTimes) && item.sourceTransaction.reminderTimes.length ? item.sourceTransaction.reminderTimes : prefs.reminderTimes;

    if (text.templateKey.endsWith("_OVERDUE")) {
      const todayKey = dateKey(today, timeZone);
      await upsertNotification({
        userId,
        notificationKey: `overdue:${item._id}:${todayKey}`,
        dedupeKey: `${userId}:${item._id}:${text.type}:${todayKey}:OVERDUE`,
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
        scheduledFor: now,
        deepLink: `/obligations/${item._id}`
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
        notificationKey: `due-catchup:${item._id}:${dateKey(today, timeZone)}`,
        dedupeKey: `${userId}:${item._id}:${text.type}:${dateKey(today, timeZone)}:CATCHUP`,
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
        scheduledFor: reminderAt,
        deepLink: `/obligations/${item._id}`
      });
      continue;
    }

    for (const time of scheduledTimes) {
      const reminderAt = withTime(today, time, timeZone);
      if (reminderAt > now) continue;
      await upsertNotification({
        userId,
        notificationKey: `due:${item._id}:${dateKey(today, timeZone)}:${time}`,
        dedupeKey: `${userId}:${item._id}:${text.type}:${dateKey(today, timeZone)}:${time}`,
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
        scheduledFor: reminderAt,
        deepLink: `/obligations/${item._id}`
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
      const now = new Date();
      const pending = await Notification.find({
        userId: String(id),
        reminderAt: { $lte: now },
        attempts: { $lt: MAX_DELIVERY_ATTEMPTS },
        status: { $nin: ["ARCHIVED", "READ"] },
        $and: [
          { $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }] },
          { $or: [{ deliveryStatus: { $in: ["SCHEDULED", "QUEUED", "FAILED", "PUSH_FAILED"] } }, { deliveryStatus: "PROCESSING", updatedAt: { $lt: new Date(Date.now() - 5 * 60_000) } }] }
        ]
      }).limit(100);
      for (const notification of pending) {
        const claim = await Notification.updateOne({
          _id: notification._id,
          attempts: { $lt: MAX_DELIVERY_ATTEMPTS },
          status: { $nin: ["ARCHIVED", "READ"] },
          $and: [
            { $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }] },
            { $or: [{ deliveryStatus: { $in: ["SCHEDULED", "QUEUED", "FAILED", "PUSH_FAILED"] } }, { deliveryStatus: "PROCESSING", updatedAt: { $lt: new Date(Date.now() - 5 * 60_000) } }] }
          ]
        }, { $set: { deliveryStatus: "PROCESSING", lastAttemptAt: now }, $inc: { attempts: 1, attemptCount: 1 } });
        if (!claim.modifiedCount) continue;
        if (notification.obligation) {
          const obligation = await Obligation.findOne({ _id: notification.obligation, userId: String(id) }).populate("person", "name");
          if (!obligation || obligation.remainingAmount <= 0 || ["SETTLED", "CANCELLED"].includes(obligation.status)) {
            await Notification.updateOne({ _id: notification._id }, { $set: { deliveryStatus: "CANCELLED", status: "ARCHIVED" } });
            continue;
          }
          const user = await User.findById(id).select("preferences");
          const timeZone = user?.preferences?.timezone || "Asia/Kolkata";
          const current = notificationText(obligation, obligation.dueDate || notification.dueDate, new Date(), timeZone);
          notification.title = current.title;
          notification.message = current.message;
          notification.amount = current.amount;
          notification.remainingAmount = current.amount;
          notification.templateKey = current.templateKey;
          notification.personId = obligation.person?._id;
          notification.deepLink = `/obligations/${obligation._id}`;
          await notification.save();
        }
        const outcome = await deliverPush(notification);
        const update = { $addToSet: { deliveredDevices: { $each: outcome.deliveredDeviceIds || [] } } };
        if (outcome.failed) {
          const attempt = Number(notification.attempts || 0) + 1;
          const exhausted = attempt >= MAX_DELIVERY_ATTEMPTS;
          update.$set = {
            deliveryStatus: exhausted ? "FAILED" : "PUSH_FAILED",
            lastError: outcome.lastError || "Push delivery failed"
          };
          if (!exhausted) update.$set.nextAttemptAt = new Date(Date.now() + Math.min(60, 2 ** attempt) * 60_000);
          else update.$unset = { nextAttemptAt: "" };
        } else {
          update.$set = { deliveryStatus: "SENT", sentAt: new Date(), lastError: "" };
          update.$unset = { nextAttemptAt: "" };
        }
        await Notification.updateOne({ _id: notification._id }, update);
      }
    } catch (error) {
      console.error("[reminders] user processing failed", { name: error.name, code: error.code, message: error.message });
    }
  }
}

function filterMatch(filter) {
  if (filter === "due_today_pay") return { type: { $in: ["DUE_TODAY", "PAYMENT_DUE_TODAY"] }, direction: "PAY" };
  if (filter === "due_today_receive") return { type: { $in: ["DUE_TODAY", "RECEIVABLE_DUE_TODAY"] }, direction: "RECEIVE" };
  if (filter === "upcoming_pay") return { type: { $in: ["TO_PAY", "PAYMENT_DUE_SOON", "LOAN_REPAYMENT_DUE"] }, direction: "PAY" };
  if (filter === "upcoming_receive") return { type: { $in: ["TO_RECEIVE", "RECEIVABLE_DUE_SOON"] }, direction: "RECEIVE" };
  if (filter === "overdue_pay") return { type: { $in: ["OVERDUE", "PAYMENT_OVERDUE"] }, direction: "PAY" };
  if (filter === "overdue_receive") return { type: { $in: ["OVERDUE", "RECEIVABLE_OVERDUE"] }, direction: "RECEIVE" };
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

function inferPlatform(userAgent = "") {
  const value = String(userAgent);
  if (/iphone|ipad|ipod/i.test(value)) return "iOS PWA/Safari";
  if (/android/i.test(value)) return "Android Chrome/PWA";
  if (/edg/i.test(value)) return "Desktop Edge";
  if (/chrome|chromium/i.test(value)) return "Desktop Chrome";
  if (/safari/i.test(value)) return "Safari";
  return "Browser";
}

export const savePushSubscription = asyncHandler(async (req, res) => {
  const subscription = req.body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) throw new ApiError("Invalid push subscription", 400);
  const endpoint = String(subscription.endpoint);
  if (endpoint.length > 2048) throw new ApiError("Invalid push endpoint", 400);
  await PushSubscription.updateMany({ endpoint, userId: { $ne: req.userId } }, { $set: { isActive: false, lastFailureAt: new Date(), lastErrorCode: "OWNER_CHANGED" } });
  const userAgent = String(req.get("User-Agent") || "");
  const record = await PushSubscription.findOneAndUpdate(
    { userId: req.userId, endpoint },
    {
      $set: {
        userId: req.userId,
        endpoint,
        keys: { p256dh: String(subscription.keys.p256dh), auth: String(subscription.keys.auth) },
        deviceId: req.body.deviceId || "",
        deviceLabel: req.body.deviceLabel || userAgent.slice(0, 110),
        deviceName: req.body.deviceName || "",
        platform: req.body.platform || inferPlatform(userAgent),
        isActive: true,
        lastUsedAt: new Date()
      }
    },
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

export const listPushDevices = asyncHandler(async (req, res) => {
  const devices = await PushSubscription.find({ userId: req.userId })
    .select("deviceId deviceLabel deviceName platform isActive createdAt updatedAt lastUsedAt lastSuccessAt lastFailureAt failureCount")
    .sort({ isActive: -1, updatedAt: -1 });
  successResponse(res, devices, "Notification devices fetched");
});

export const disablePushDevice = asyncHandler(async (req, res) => {
  const device = await PushSubscription.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { $set: { isActive: false } },
    { new: true }
  );
  if (!device) throw new ApiError("Notification device not found", 404);
  successResponse(res, device, "Notification device disabled");
});

export const getNotificationSettings = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId).select("preferences");
  successResponse(res, { timezone: normalizeFinanceTimeZone(user?.preferences?.timezone), ...notificationPreferences(user) }, "Notification settings fetched");
});

export const updateNotificationSettings = asyncHandler(async (req, res) => {
  const allowedBooleans = ["pushEnabled", "paymentReminders", "receivableReminders", "overdueReminders", "settlementConfirmations", "recurringReminders"];
  const updates = {};
  for (const key of allowedBooleans) {
    if (req.body[key] !== undefined) updates[`preferences.notifications.${key}`] = Boolean(req.body[key]);
  }
  if (req.body.preview !== undefined) {
    if (!["DETAILED", "PRIVATE"].includes(req.body.preview)) throw new ApiError("Invalid notification preview setting", 400);
    updates["preferences.notifications.preview"] = req.body.preview;
  }
  if (req.body.reminderStartDaysBefore !== undefined) {
    const days = Number(req.body.reminderStartDaysBefore);
    if (!Number.isFinite(days) || days < 0 || days > 30) throw new ApiError("Invalid reminder start", 400);
    updates["preferences.notifications.reminderStartDaysBefore"] = days;
  }
  if (req.body.reminderTimes !== undefined) {
    const times = Array.isArray(req.body.reminderTimes) ? req.body.reminderTimes.slice(0, 3) : [];
    if (!times.length || times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time)))) throw new ApiError("Invalid reminder times", 400);
    updates["preferences.notifications.reminderTimes"] = times;
  }
  if (req.body.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: req.body.timezone });
    } catch {
      throw new ApiError("Invalid timezone", 400);
    }
    updates["preferences.timezone"] = req.body.timezone;
  }
  if (!Object.keys(updates).length) throw new ApiError("No notification settings provided", 400);
  const user = await User.findByIdAndUpdate(req.userId, { $set: updates }, { new: true, runValidators: true }).select("preferences");
  successResponse(res, { timezone: normalizeFinanceTimeZone(user?.preferences?.timezone), ...notificationPreferences(user) }, "Notification settings updated");
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
