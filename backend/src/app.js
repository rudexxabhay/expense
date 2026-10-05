import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import accountRoutes from "./routes/accountRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import backupRoutes from "./routes/backupRoutes.js";
import budgetRoutes from "./routes/budgetRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import obligationRoutes from "./routes/obligationRoutes.js";
import personRoutes from "./routes/personRoutes.js";
import quickAddRoutes from "./routes/quickAddRoutes.js";
import recurringRoutes from "./routes/recurringRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import tagRoutes from "./routes/tagRoutes.js";
import transactionRoutes from "./routes/transactionRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import { errorHandler, notFoundHandler } from "./middleware/errorMiddleware.js";
import authMiddleware from "./middleware/authMiddleware.js";
import { successResponse } from "./utils/apiResponse.js";
import { createRateLimit } from "./middleware/rateLimit.js";
import { publishRealtimeEvent } from "./services/realtimeService.js";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const totalMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    if (process.env.NODE_ENV !== "production" && req.path.match(/^\/api\/(transactions\/summary|transactions\/reports|obligations|activity|accounts|people)/)) {
      console.info("[perf]", { path: req.path, method: req.method, status: res.statusCode, totalMs: Math.round(totalMs) });
    }
    if (!req.userId || res.statusCode >= 300 || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
    if (!req.path.match(/^\/api\/(transactions|obligations|accounts|people|notifications)/)) return;
    publishRealtimeEvent(req.userId, {
      type: `${req.method.toLowerCase()}.${req.path.replace(/^\/api\//, "").replace(/\//g, ".")}`,
      path: req.path,
      method: req.method
    });
  });
  next();
});

const authRateLimit = createRateLimit({ windowMs: 60_000, max: 12, keyPrefix: "auth" });
const writeRateLimit = createRateLimit({ windowMs: 60_000, max: 90, keyPrefix: "write" });

app.get("/api/health", (req, res) => {
  successResponse(res, { status: "ok" }, "API is healthy");
});

app.use("/api/events", eventRoutes);
app.use("/api/auth", authRateLimit, authRoutes);
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return writeRateLimit(req, res, next);
  return next();
});
app.use("/api/users", authMiddleware, userRoutes);
app.use("/api/accounts", authMiddleware, accountRoutes);
app.use("/api/activity", authMiddleware, activityRoutes);
app.use("/api/people", authMiddleware, personRoutes);
app.use("/api/categories", authMiddleware, categoryRoutes);
app.use("/api/tags", authMiddleware, tagRoutes);
app.use("/api/transactions", authMiddleware, transactionRoutes);
app.use("/api/obligations", authMiddleware, obligationRoutes);
app.use("/api/notifications", authMiddleware, notificationRoutes);
app.use("/api/recurring", authMiddleware, recurringRoutes);
app.use("/api/budgets", authMiddleware, budgetRoutes);
app.use("/api/quick-add", authMiddleware, quickAddRoutes);
app.use("/api/backups", authMiddleware, backupRoutes);
app.use("/api/reports", authMiddleware, reportRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
