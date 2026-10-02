import crypto from "crypto";

function base64UrlEncode(input) {
  return Buffer.from(JSON.stringify(input)).toString("base64url");
}

function base64UrlDecode(input) {
  return JSON.parse(Buffer.from(input, "base64url").toString("utf8"));
}

function parseExpiry(value = "7d") {
  const match = String(value).match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60;
  const amount = Number(match[1]);
  const unit = match[2];
  return amount * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
}

function signPayload(encodedHeader, encodedPayload, secret) {
  return crypto.createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
}

function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("JWT_SECRET is required");
  if (!globalThis.__expenseTrackerDevJwtSecret) {
    globalThis.__expenseTrackerDevJwtSecret = crypto.randomBytes(32).toString("hex");
    console.warn("JWT_SECRET is missing. Using a temporary development secret for this process.");
  }
  return globalThis.__expenseTrackerDevJwtSecret;
}

export function assertJwtConfig() {
  getJwtSecret();
}

export function signToken(payload) {
  const secret = getJwtSecret();

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const body = {
    ...payload,
    iat: now,
    exp: now + parseExpiry(process.env.JWT_ACCESS_EXPIRES_IN || process.env.JWT_EXPIRES_IN || "30m")
  };
  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(body);
  return `${encodedHeader}.${encodedPayload}.${signPayload(encodedHeader, encodedPayload, secret)}`;
}

export function verifyToken(token) {
  const secret = getJwtSecret();

  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) return null;

  const expectedSignature = signPayload(encodedHeader, encodedPayload, secret);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  const payload = base64UrlDecode(encodedPayload);
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
