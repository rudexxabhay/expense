import ApiError from "../utils/ApiError.js";

const buckets = new Map();

export function createRateLimit({ windowMs = 60_000, max = 120, keyPrefix = "global" } = {}) {
  return function rateLimit(req, res, next) {
    const key = `${keyPrefix}:${req.userId || req.ip || "anonymous"}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      return next(new ApiError("Too many requests. Please try again shortly.", 429));
    }

    return next();
  };
}
