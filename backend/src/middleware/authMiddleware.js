import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { verifyToken } from "../utils/jwt.js";

export default async function authMiddleware(req, res, next) {
  try {
    const header = req.header("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return next(new ApiError("Authentication required", 401));
    }

    const payload = verifyToken(token);
    if (!payload?.sub) {
      return next(new ApiError("Invalid or expired session", 401));
    }

    const user = await User.findById(payload.sub).select("-passwordHash -refreshSessions");
    if (!user || Number(payload.sv || 0) !== Number(user.sessionVersion || 0)) {
      return next(new ApiError("Invalid session user", 401));
    }

    req.user = user;
    req.userId = String(user._id);
    next();
  } catch (err) {
    next(err);
  }
}
