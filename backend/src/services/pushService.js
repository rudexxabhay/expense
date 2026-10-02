import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";
import https from "node:https";
import { URL } from "node:url";
import PushSubscription from "../models/PushSubscription.js";

const decode = (value) => Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const encode = (value) => Buffer.from(value).toString("base64url");
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
  const contentKey = hkdf(inputKey, salt, Buffer.concat([contentInfo, Buffer.from([1])]), 16);
  const nonce = hkdf(inputKey, salt, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])]), 12);
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
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) return { sent: 0, failed: 1, deliveredDeviceIds: [] };
  const subscriptions = await PushSubscription.find({ userId: notification.userId, isActive: true });
  const alreadyDelivered = new Set((notification.deliveredDevices || []).map(String));
  const payload = JSON.stringify({ title: notification.title, body: notification.message, notificationId: String(notification._id), obligationId: notification.obligation ? String(notification.obligation) : "", personId: notification.personId ? String(notification.personId) : "", url: notification.obligation ? `/obligations/${notification.obligation}` : "/home" });
  let sent = 0;
  let failed = 0;
  const deliveredDeviceIds = [];
  await Promise.all(subscriptions.map(async (record) => {
    if (alreadyDelivered.has(String(record._id))) return;
    try {
      const encrypted = encryptPayload(record, payload);
      const status = await sendRequest(record.endpoint, {
        TTL: "86400", Urgency: "high", "Content-Type": "application/octet-stream", "Content-Encoding": "aes128gcm",
        Authorization: `vapid t=${vapidToken(record.endpoint)}, k=${process.env.VAPID_PUBLIC_KEY}`
      }, encrypted.body);
      if (status === 404 || status === 410) {
        record.isActive = false;
        await record.save();
      } else if (status >= 200 && status < 300) {
        record.lastUsedAt = new Date();
        await record.save();
        sent += 1;
        deliveredDeviceIds.push(record._id);
      } else failed += 1;
    } catch {
      failed += 1;
    }
  }));
  return { sent, failed: failed || (subscriptions.length === 0 ? 1 : 0), deliveredDeviceIds };
}
