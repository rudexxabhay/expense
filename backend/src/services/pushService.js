import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";
import https from "node:https";
import { URL } from "node:url";
import PushDeliveryAttempt from "../models/PushDeliveryAttempt.js";
import PushSubscription from "../models/PushSubscription.js";
import User from "../models/User.js";

const REQUIRED_VAPID_ENV = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];

const decode = (value) => Buffer.from(String(value || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
const encode = (value) => Buffer.from(value).toString("base64url");

function vapidConfigStatus() {
  const missing = REQUIRED_VAPID_ENV.filter((key) => !process.env[key]);
  const invalid = [];
  if (!missing.includes("VAPID_PUBLIC_KEY") && decode(process.env.VAPID_PUBLIC_KEY).length !== 65) invalid.push("VAPID_PUBLIC_KEY");
  if (!missing.includes("VAPID_PRIVATE_KEY") && decode(process.env.VAPID_PRIVATE_KEY).length !== 32) invalid.push("VAPID_PRIVATE_KEY");
  if (!missing.includes("VAPID_SUBJECT") && !/^(mailto:|https?:\/\/)/i.test(process.env.VAPID_SUBJECT)) invalid.push("VAPID_SUBJECT");
  return { configured: missing.length === 0 && invalid.length === 0, missing, invalid };
}

export function isVapidConfigured() {
  return vapidConfigStatus().configured;
}

export function validateVapidConfiguration({ strict = process.env.NODE_ENV === "production" } = {}) {
  const status = vapidConfigStatus();
  if (status.configured) return true;
  const details = [
    status.missing.length ? `missing: ${status.missing.join(", ")}` : "",
    status.invalid.length ? `invalid: ${status.invalid.join(", ")}` : ""
  ].filter(Boolean).join("; ");
  const message = `[push] VAPID configuration is incomplete (${details}). Configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.`;
  if (strict) throw new Error(message);
  console.warn(message);
  return false;
}

function hkdf(secret, salt, info, length) {
  const prk = createHmac("sha256", salt).update(secret).digest();
  let output = Buffer.alloc(0);
  let previous = Buffer.alloc(0);
  for (let counter = 1; output.length < length; counter += 1) {
    previous = createHmac("sha256", prk).update(Buffer.concat([previous, Buffer.from(info), Buffer.from([counter])])).digest();
    output = Buffer.concat([output, previous]);
  }
  return output.subarray(0, length);
}
function vapidToken(endpoint) {
  const publicKey = decode(process.env.VAPID_PUBLIC_KEY);
  const privateKey = decode(process.env.VAPID_PRIVATE_KEY);
  const header = encode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: process.env.VAPID_SUBJECT }));
  const content = `${header}.${claims}`;
  const jwk = { kty: "EC", crv: "P-256", x: encode(publicKey.subarray(1, 33)), y: encode(publicKey.subarray(33, 65)), d: encode(privateKey) };
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  const signature = sign("sha256", Buffer.from(content), { key, dsaEncoding: "ieee-p1363" });
  return `${content}.${encode(signature)}`;
}
function encryptPayload(subscription, payload) {
  const clientPublic = decode(subscription.keys.p256dh);
  const authSecret = decode(subscription.keys.auth);
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const serverPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(clientPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), clientPublic, serverPublic]);
  const inputKey = hkdf(shared, authSecret, keyInfo, 32);
  const salt = randomBytes(16);
  const contentInfo = Buffer.from("Content-Encoding: aes128gcm\0");
  const contentKey = hkdf(inputKey, salt, contentInfo, 16);
  const nonce = hkdf(inputKey, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return { body: Buffer.concat([salt, recordSize, Buffer.from([serverPublic.length]), serverPublic, encrypted]), salt: encode(salt), serverPublic: encode(serverPublic) };
}
function sendRequest(endpoint, headers, body) {
  return new Promise((resolve, reject) => {
    const request = https.request(endpoint, { method: "POST", headers }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.setTimeout(12_000, () => request.destroy(new Error("Push delivery timed out")));
    request.end(body);
  });
}

export async function deliverPush(notification) {
  if (!isVapidConfigured()) return { sent: 0, failed: 1, disabled: 0, deliveredDeviceIds: [], attempts: [], lastError: "VAPID is not configured" };
  const user = await User.findById(notification.userId).select("preferences.notifications");
  if (user?.preferences?.notifications?.pushEnabled === false) return { sent: 0, failed: 0, disabled: 0, deliveredDeviceIds: [], attempts: [] };
  const subscriptions = await PushSubscription.find({ userId: notification.userId, isActive: true });
  const alreadyDelivered = new Set((notification.deliveredDevices || []).map(String));
  const isSystemTest = notification.templateKey === "TEST_PUSH" || notification.type === "SYSTEM";
  const privatePreview = !isSystemTest && user?.preferences?.notifications?.preview === "PRIVATE";
  const title = privatePreview ? "Expense reminder" : notification.title;
  const body = privatePreview ? "You have a financial reminder." : (notification.body || notification.message);
  const deepLink = notification.deepLink || (notification.obligation ? `/obligations/${notification.obligation}` : "/home");
  const payload = JSON.stringify({
    title,
    body,
    icon: "/icons/icon.svg",
    badge: "/icons/icon.svg",
    tag: isSystemTest ? "test-notification" : notification.obligation ? `obligation-${notification.obligation}-${notification.type}` : `notification-${notification._id}`,
    notificationId: String(notification._id),
    type: notification.type,
    obligationId: notification.obligation ? String(notification.obligation) : "",
    sourceTransactionId: notification.sourceTransactionId ? String(notification.sourceTransactionId) : notification.transaction ? String(notification.transaction) : "",
    personId: notification.personId ? String(notification.personId) : "",
    deepLink,
    url: deepLink
  });
  let sent = 0;
  let failed = 0;
  let disabled = 0;
  let lastError = "";
  const deliveredDeviceIds = [];
  const attempts = [];
  await Promise.all(subscriptions.map(async (record) => {
    if (alreadyDelivered.has(String(record._id))) return;
    const attempt = Number(notification.attempts || 0) + 1;
    const diagnostic = {
      notificationId: String(notification._id),
      subscriptionId: String(record._id),
      status: null,
      result: "FAILED",
      failureType: ""
    };
    try {
      const encrypted = encryptPayload(record, payload);
      const status = await sendRequest(record.endpoint, {
        TTL: "86400", Urgency: "high", "Content-Type": "application/octet-stream", "Content-Encoding": "aes128gcm",
        Authorization: `vapid t=${vapidToken(record.endpoint)}, k=${process.env.VAPID_PUBLIC_KEY}`
      }, encrypted.body);
      diagnostic.status = status;
      if (status === 404 || status === 410) {
        disabled += 1;
        diagnostic.result = "DISABLED";
        diagnostic.failureType = "subscription_expired";
        record.isActive = false;
        record.lastFailureAt = new Date();
        record.lastErrorCode = String(status);
        record.failureCount = Number(record.failureCount || 0) + 1;
        await record.save();
        await PushDeliveryAttempt.create({ userId: notification.userId, notification: notification._id, subscription: record._id, attempt, status: "DISABLED", errorCode: String(status), errorMessage: "Push subscription expired or is gone" });
      } else if (status >= 200 && status < 300) {
        diagnostic.result = "SENT";
        record.lastUsedAt = new Date();
        record.lastSuccessAt = new Date();
        record.failureCount = 0;
        record.lastErrorCode = "";
        await record.save();
        sent += 1;
        deliveredDeviceIds.push(record._id);
        await PushDeliveryAttempt.create({ userId: notification.userId, notification: notification._id, subscription: record._id, attempt, status: "SENT", sentAt: new Date() });
      } else {
        failed += 1;
        diagnostic.result = "FAILED";
        diagnostic.failureType = "provider_rejected";
        lastError = `Push provider returned ${status}`;
        record.lastFailureAt = new Date();
        record.lastErrorCode = String(status);
        record.failureCount = Number(record.failureCount || 0) + 1;
        await record.save();
        await PushDeliveryAttempt.create({ userId: notification.userId, notification: notification._id, subscription: record._id, attempt, status: "FAILED", errorCode: String(status), errorMessage: lastError });
      }
    } catch (error) {
      failed += 1;
      diagnostic.result = "FAILED";
      diagnostic.failureType = "request_failed";
      diagnostic.errorCode = error.code || "PUSH_ERROR";
      lastError = error.message || "Push delivery failed";
      record.lastFailureAt = new Date();
      record.lastErrorCode = error.code || "PUSH_ERROR";
      record.failureCount = Number(record.failureCount || 0) + 1;
      await record.save();
      await PushDeliveryAttempt.create({ userId: notification.userId, notification: notification._id, subscription: record._id, attempt, status: "FAILED", errorCode: record.lastErrorCode, errorMessage: lastError });
    } finally {
      attempts.push(diagnostic);
      console.info("[push] delivery attempt", diagnostic);
    }
  }));
  return { sent, failed: failed || (subscriptions.length === 0 ? 1 : 0), disabled, deliveredDeviceIds, attempts, lastError: lastError || (subscriptions.length === 0 ? "No active push subscriptions" : "") };
}
