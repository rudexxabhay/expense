import mongoose from "mongoose";
import crypto from "node:crypto";
import User from "../models/User.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { successResponse } from "../utils/apiResponse.js";
import { assertJwtConfig, signToken } from "../utils/jwt.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    initials: user.initials,
    avatarColor: user.avatarColor,
    preferences: {
      theme: user.preferences?.theme,
      timezone: user.preferences?.timezone,
      notifications: user.preferences?.notifications
    },
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function makeInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function assertEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hasValidPasswordHash(passwordHash) {
  return typeof passwordHash === "string" && /^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(passwordHash);
}

function isCompleteUser(user) {
  return Boolean(user?.name?.trim() && assertEmail(user.email || "") && hasValidPasswordHash(user.passwordHash));
}

const REFRESH_COOKIE = "expense_refresh";
const refreshLifetimeMs = () => {
  const match = String(process.env.JWT_REFRESH_EXPIRES_IN || "14d").match(/^(\d+)([smhd])$/);
  if (!match) return 14 * 24 * 60 * 60 * 1000;
  return Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
};
const hashRefreshToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/api/auth",
  maxAge: refreshLifetimeMs()
});
const readCookie = (req, name) => {
  const cookies = String(req.headers.cookie || "").split(";");
  const entry = cookies.map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
};

async function issueSession(user, res) {
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + refreshLifetimeMs());
  user.refreshSessions = (user.refreshSessions || []).filter((session) => session.expiresAt > new Date());
  user.refreshSessions.push({ tokenHash: hashRefreshToken(refreshToken), expiresAt });
  await user.save();
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
  return signToken({ sub: String(user._id), sv: Number(user.sessionVersion || 0) });
}

function clearRefreshCookie(res) {
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie(REFRESH_COOKIE, options);
}

export const signup = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  const normalizedName = String(name || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const errors = [];

  if (!normalizedName) errors.push({ field: "name", message: "Full name is required." });
  if (!normalizedEmail) errors.push({ field: "email", message: "Email is required." });
  else if (!assertEmail(normalizedEmail)) errors.push({ field: "email", message: "Please enter a valid email." });
  if (!password) errors.push({ field: "password", message: "Password is required." });
  else if (String(password).length < 8) errors.push({ field: "password", message: "Password must be at least 8 characters." });
  else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.push({ field: "password", message: "Use at least one letter and one number." });
  }

  if (errors.length) throw new ApiError("Validation failed", 400, errors);

  assertJwtConfig();

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    if (isCompleteUser(existing)) {
      throw new ApiError("An account already exists with this email. Login instead.", 409, [
        { field: "email", message: "An account already exists with this email. Login instead." }
      ]);
    }

    if (process.env.NODE_ENV !== "production") {
      await User.deleteOne({ _id: existing._id });
    } else {
      throw new ApiError("An account already exists with this email. Login instead.", 409, [
        { field: "email", message: "An account already exists with this email. Login instead." }
      ]);
    }
  }

  const passwordHash = await hashPassword(password);

  const userId = new mongoose.Types.ObjectId();
  const user = await User.create({
    _id: userId,
    name: normalizedName,
    email: normalizedEmail,
    passwordHash,
    initials: makeInitials(normalizedName)
  });
  const token = await issueSession(user, res);

  successResponse(res, { user: publicUser(user), token }, "Signup successful", 201);
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const errors = [];

  if (!normalizedEmail) errors.push({ field: "email", message: "Email is required." });
  else if (!assertEmail(normalizedEmail)) errors.push({ field: "email", message: "Please enter a valid email." });
  if (!password) errors.push({ field: "password", message: "Password is required." });
  if (errors.length) throw new ApiError("Validation failed", 400, errors);

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    throw new ApiError("No account found with this email.", 404, [
      { field: "email", message: "No account found with this email." }
    ]);
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError("Incorrect password.", 401, [
      { field: "password", message: "Incorrect password." }
    ]);
  }

  const token = await issueSession(user, res);
  successResponse(res, { user: publicUser(user), token }, "Login successful");
});

export const logout = asyncHandler(async (req, res) => {
  const refreshToken = readCookie(req, REFRESH_COOKIE);
  if (refreshToken) {
    const tokenHash = hashRefreshToken(refreshToken);
    await User.updateOne(
      { refreshSessions: { $elemMatch: { $or: [{ tokenHash }, { previousTokenHash: tokenHash }] } } },
      { $set: { refreshSessions: [] }, $inc: { sessionVersion: 1 } }
    );
  }
  clearRefreshCookie(res);
  successResponse(res, null, "Logout successful");
});

export const refreshSession = asyncHandler(async (req, res) => {
  const refreshToken = readCookie(req, REFRESH_COOKIE);
  if (!refreshToken) throw new ApiError("Session expired. Please login again.", 401);
  const oldHash = hashRefreshToken(refreshToken);
  const now = new Date();
  const matchingSession = {
    expiresAt: { $gt: now },
    $or: [
      { tokenHash: oldHash },
      { previousTokenHash: oldHash, previousValidUntil: { $gt: now } }
    ]
  };
  const tokenUser = await User.findOne({ refreshSessions: { $elemMatch: matchingSession } });
  const session = tokenUser?.refreshSessions.find((item) =>
    item.expiresAt > now && (
      item.tokenHash === oldHash ||
      (item.previousTokenHash === oldHash && item.previousValidUntil > now)
    )
  );
  let user = null;
  if (session?.tokenHash === oldHash) {
    const nextRefreshToken = crypto.randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + refreshLifetimeMs());
    user = await User.findOneAndUpdate(
      { _id: tokenUser._id, refreshSessions: { $elemMatch: { tokenHash: oldHash, expiresAt: { $gt: now } } } },
      { $set: {
        "refreshSessions.$.previousTokenHash": oldHash,
        "refreshSessions.$.previousValidUntil": new Date(Date.now() + 30_000),
        "refreshSessions.$.tokenHash": hashRefreshToken(nextRefreshToken),
        "refreshSessions.$.expiresAt": expiresAt,
        "refreshSessions.$.createdAt": new Date()
      } },
      { new: true }
    );
    if (user) res.cookie(REFRESH_COOKIE, nextRefreshToken, cookieOptions());
    if (!user) {
      user = await User.findOne({
        _id: tokenUser._id,
        refreshSessions: { $elemMatch: { previousTokenHash: oldHash, previousValidUntil: { $gt: new Date() }, expiresAt: { $gt: new Date() } } }
      });
    }
  } else if (session) {
    user = tokenUser;
  }
  if (!user) {
    clearRefreshCookie(res);
    throw new ApiError("Session expired. Please login again.", 401);
  }
  const token = signToken({ sub: String(user._id), sv: Number(user.sessionVersion || 0) });
  successResponse(res, { token }, "Session refreshed");
});

export const getCurrentUser = asyncHandler(async (req, res) => {
  successResponse(res, publicUser(req.user), "Current user fetched");
});
