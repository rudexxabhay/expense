import mongoose from "mongoose";
import Budget from "../models/Budget.js";
import Category from "../models/Category.js";
import Settlement from "../models/Settlement.js";
import Transaction from "../models/Transaction.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { successResponse } from "../utils/apiResponse.js";
import {
  PERSONAL_EXPENSE_TYPES,
  payableSettlementExpenseMatch,
  payableSettlementExpenseObligationMatch,
  personalExpenseAmountExpression
} from "../utils/financeRules.js";

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function monthRange(month, year) {
  return {
    start: new Date(Number(year), Number(month) - 1, 1),
    end: new Date(Number(year), Number(month), 1)
  };
}

async function assertCategory(category, userId) {
  if (!category || !isValidId(category)) throw new ApiError("Valid category is required", 400);
  const found = await Category.findOne({ _id: category, userId, isActive: true, type: "EXPENSE" });
  if (!found) throw new ApiError("Expense category not found", 404);
}

async function budgetRows(userId, month, year) {
  const { start, end } = monthRange(month, year);
  const [budgets, spending, settlementSpending] = await Promise.all([
    Budget.find({ userId, month, year, isActive: true }).populate("category", "name color icon"),
    Transaction.aggregate([
      {
        $match: {
          userId,
          status: "ACTIVE",
          type: { $in: PERSONAL_EXPENSE_TYPES },
          category: { $ne: null },
          transactionDate: { $gte: start, $lt: end }
        }
      },
      {
        $group: {
          _id: "$category",
          spent: { $sum: personalExpenseAmountExpression() }
        }
      }
    ]),
    Settlement.aggregate([
      { $match: payableSettlementExpenseMatch(userId, { $gte: start, $lt: end }) },
      { $lookup: { from: "settlementallocations", localField: "_id", foreignField: "settlement", as: "allocation" } },
      { $unwind: "$allocation" },
      { $match: { "allocation.userId": userId } },
      { $lookup: { from: "obligations", localField: "allocation.obligation", foreignField: "_id", as: "obligation" } },
      { $unwind: "$obligation" },
      { $match: payableSettlementExpenseObligationMatch(userId) },
      { $lookup: { from: "transactions", localField: "obligation.sourceTransaction", foreignField: "_id", as: "sourceTransaction" } },
      { $unwind: "$sourceTransaction" },
      { $match: { "sourceTransaction.userId": userId, "sourceTransaction.category": { $ne: null } } },
      { $group: { _id: "$sourceTransaction.category", spent: { $sum: "$allocation.amount" } } }
    ])
  ]);

  const spentByCategory = new Map(spending.map((item) => [String(item._id), item.spent]));
  for (const item of settlementSpending) {
    const key = String(item._id);
    spentByCategory.set(key, Number(spentByCategory.get(key) || 0) + Number(item.spent || 0));
  }
  return budgets.map((budget) => {
    const spent = spentByCategory.get(String(budget.category?._id)) || 0;
    const remaining = Number(budget.limitAmount) - spent;
    const usedPercent = Math.round((spent / Number(budget.limitAmount || 1)) * 100);
    return {
      ...budget.toObject(),
      spent,
      remaining,
      usedPercent,
      state: usedPercent >= 100 ? "EXCEEDED" : usedPercent >= Number(budget.warningAtPercent || 80) ? "WARNING" : "OK"
    };
  });
}

export const listBudgets = asyncHandler(async (req, res) => {
  const now = new Date();
  const month = Number(req.query.month || now.getMonth() + 1);
  const year = Number(req.query.year || now.getFullYear());
  const budgets = await budgetRows(req.userId, month, year);
  successResponse(res, budgets, "Budgets fetched");
});

export const createBudget = asyncHandler(async (req, res) => {
  const now = new Date();
  const month = Number(req.body.month || now.getMonth() + 1);
  const year = Number(req.body.year || now.getFullYear());
  await assertCategory(req.body.category, req.userId);
  const budget = await Budget.create({
    userId: req.userId,
    category: req.body.category,
    month,
    year,
    limitAmount: Number(req.body.limitAmount),
    warningAtPercent: Number(req.body.warningAtPercent || 80)
  });
  successResponse(res, budget, "Budget created", 201);
});

export const updateBudget = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) throw new ApiError("Invalid budget id", 400);
  if (req.body.category) await assertCategory(req.body.category, req.userId);
  const budget = await Budget.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    req.body,
    { new: true, runValidators: true }
  );
  if (!budget) throw new ApiError("Budget not found", 404);
  successResponse(res, budget, "Budget updated");
});

export const deleteBudget = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) throw new ApiError("Invalid budget id", 400);
  const budget = await Budget.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { isActive: false }, { new: true });
  if (!budget) throw new ApiError("Budget not found", 404);
  successResponse(res, budget, "Budget removed");
});
