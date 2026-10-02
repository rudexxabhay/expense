import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import accountRoutes from "./routes/accountRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import backupRoutes from "./routes/backupRoutes.js";
import budgetRoutes from "./routes/budgetRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
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

dotenv.config();

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));

const authRateLimit = createRateLimit({ windowMs: 60_000, max: 12, keyPrefix: "auth" });
const writeRateLimit = createRateLimit({ windowMs: 60_000, max: 90, keyPrefix: "write" });

app.get("/api/health", (req, res) => {
  successResponse(res, { status: "ok" }, "API is healthy");
});

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
