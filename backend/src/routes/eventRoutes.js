import express from "express";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { verifyToken } from "../utils/jwt.js";
import { subscribeToRealtime } from "../services/realtimeService.js";

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const token = req.query.token || "";
    const payload = verifyToken(String(token));
    if (!payload?.sub) throw new ApiError("Authentication required", 401);
    const user = await User.findById(payload.sub).select("sessionVersion").lean();
    if (!user || Number(payload.sv || 0) !== Number(user.sessionVersion || 0)) throw new ApiError("Invalid session user", 401);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
    subscribeToRealtime(String(user._id), res);
  } catch (error) {
    next(error);
  }
});

export default router;
