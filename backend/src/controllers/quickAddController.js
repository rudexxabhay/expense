import mongoose from "mongoose";
import Account from "../models/Account.js";
import Category from "../models/Category.js";
import QuickAddPreset from "../models/QuickAddPreset.js";
import Tag from "../models/Tag.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { successResponse } from "../utils/apiResponse.js";

const DEFAULT_QUICK_EXPENSE_PRESETS = [
  ["Food", "Breakfast", "Utensils"],
  ["Food", "Lunch", "Utensils"],
  ["Food", "Dinner", "Utensils"],
  ["Food", "Tea/Coffee", "Coffee"],
  ["Food", "Snacks", "Cookie"],
  ["Food", "Restaurant", "Soup"],
  ["Food", "Swiggy/Zomato", "Bike"],
  ["Travel", "Metro", "Train"],
  ["Travel", "Metro Recharge", "Train", 500],
  ["Travel", "Auto", "Car"],
  ["Travel", "Cab", "Car"],
  ["Travel", "Bus", "Bus"],
  ["Travel", "Train", "Train"],
  ["Travel", "Petrol", "Fuel"],
  ["Travel", "Parking", "ParkingCircle"],
  ["Travel", "Toll", "Route"],
  ["Daily", "Milk", "Milk"],
  ["Daily", "Groceries", "ShoppingBasket"],
  ["Daily", "Fruits", "Apple"],
  ["Daily", "Vegetables", "Carrot"],
  ["Daily", "Water", "Droplets"],
  ["Bills", "Mobile Recharge", "Smartphone"],
  ["Bills", "Electricity", "Zap"],
  ["Bills", "Wi-Fi", "Wifi"],
  ["Bills", "Gas", "Flame"],
  ["Bills", "DTH", "Tv"],
  ["Personal", "Haircut", "Scissors"],
  ["Personal", "Clothes", "Shirt"],
  ["Personal", "Shoes", "Footprints"],
  ["Personal", "Medicines", "Pill"],
  ["Personal", "Gym", "Dumbbell"],
  ["Entertainment", "Movie", "Clapperboard"],
  ["Entertainment", "Subscription", "Repeat"],
  ["Entertainment", "Outing", "MapPin"],
  ["Entertainment", "Gaming", "Gamepad2"]
].map(([presetGroup, name, icon, amount]) => ({ presetGroup, name, icon, amount }));

const CATEGORY_STYLES = {
  Food: { icon: "Utensils", color: "coral" },
  Travel: { icon: "Train", color: "primary" },
  Daily: { icon: "ShoppingBasket", color: "emerald" },
  Bills: { icon: "Receipt", color: "amber" },
  Personal: { icon: "User", color: "income" },
  Entertainment: { icon: "Sparkles", color: "violet" }
};

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

async function assertRefs(payload, userId) {
  if (payload.account) {
    const account = await Account.findOne({ _id: payload.account, userId, isActive: true });
    if (!account) throw new ApiError("Account not found", 404);
  }
  if (payload.category) {
    const category = await Category.findOne({ _id: payload.category, userId, isActive: true });
    if (!category) throw new ApiError("Category not found", 404);
  }
  if (payload.tags?.length) {
    const tagCount = await Tag.countDocuments({ _id: { $in: payload.tags }, userId });
    if (tagCount !== payload.tags.length) throw new ApiError("One or more tags were not found", 404);
  }
}

function normalize(body, userId) {
  const hasAmount = body.amount !== undefined && body.amount !== null && body.amount !== "";
  const amount = hasAmount ? Number(body.amount) : undefined;
  if (hasAmount && (!Number.isFinite(amount) || amount <= 0)) throw new ApiError("Amount must be greater than 0", 400);
  const type = body.type || "EXPENSE";
  if (!["EXPENSE", "INCOME"].includes(type)) throw new ApiError("Preset type must be income or expense", 400);
  if (body.account && !isValidId(body.account)) throw new ApiError("Invalid account", 400);
  if (body.category && !isValidId(body.category)) throw new ApiError("Invalid category", 400);
  return {
    userId,
    name: String(body.name || "").trim(),
    type,
    amount,
    account: body.account || undefined,
    category: body.category || undefined,
    tags: Array.isArray(body.tags) ? body.tags.filter(Boolean) : [],
    note: body.note || "",
    presetGroup: String(body.presetGroup || "Custom").trim(),
    icon: String(body.icon || "Receipt").trim(),
    favorite: body.favorite === true,
    isDefault: body.isDefault === true,
    isActive: body.isActive !== false
  };
}

function populate(query) {
  return query.populate("account", "name").populate("category", "name color").populate("tags", "name color");
}

async function ensureCategory(userId, name) {
  const style = CATEGORY_STYLES[name] || CATEGORY_STYLES.Daily;
  const existing = await Category.findOne({ userId, name, type: "EXPENSE" });
  if (existing) return existing.isActive ? existing : null;
  try {
    return await Category.create({
      userId,
      name,
      type: "EXPENSE",
      icon: style.icon,
      color: style.color,
      isDefault: true,
      isActive: true
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    return Category.findOne({ userId, name, type: "EXPENSE", isActive: true });
  }
}

async function ensureDefaultQuickExpensePresets(userId) {
  const categories = new Map();
  for (const group of [...new Set(DEFAULT_QUICK_EXPENSE_PRESETS.map((preset) => preset.presetGroup))]) {
    categories.set(group, await ensureCategory(userId, group));
  }

  await Promise.all(
    DEFAULT_QUICK_EXPENSE_PRESETS.map((preset) => {
      const category = categories.get(preset.presetGroup);
      return QuickAddPreset.findOneAndUpdate(
        { userId, name: preset.name },
        {
          $setOnInsert: {
            userId,
            name: preset.name,
            type: "EXPENSE",
            amount: preset.amount,
            category: category?._id,
            note: preset.name,
            presetGroup: preset.presetGroup,
            icon: preset.icon,
            favorite: false,
            isDefault: true,
            isActive: true
          }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
    })
  );
}

export const listQuickAddPresets = asyncHandler(async (req, res) => {
  await ensureDefaultQuickExpensePresets(req.userId);
  const presets = await populate(
    QuickAddPreset.find({ userId: req.userId, isActive: true }).sort({
      favorite: -1,
      lastUsedAt: -1,
      usageCount: -1,
      presetGroup: 1,
      name: 1
    })
  );
  successResponse(res, presets, "Quick add presets fetched");
});

export const createQuickAddPreset = asyncHandler(async (req, res) => {
  const payload = normalize(req.body, req.userId);
  if (!payload.name) throw new ApiError("Preset name is required", 400);
  await assertRefs(payload, req.userId);
  const inactivePreset = await QuickAddPreset.findOne({ userId: req.userId, name: payload.name, isActive: false });
  if (inactivePreset) {
    const restored = await populate(
      QuickAddPreset.findOneAndUpdate(
        { _id: inactivePreset._id, userId: req.userId },
        { ...payload, isActive: true },
        { new: true, runValidators: true }
      )
    );
    successResponse(res, restored, "Quick add preset restored", 201);
    return;
  }
  const preset = await QuickAddPreset.create(payload);
  successResponse(res, preset, "Quick add preset created", 201);
});

export const updateQuickAddPreset = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) throw new ApiError("Invalid preset id", 400);
  const existing = await QuickAddPreset.findOne({ _id: req.params.id, userId: req.userId, isActive: true });
  if (!existing) throw new ApiError("Quick add preset not found", 404);
  const payload = normalize({ ...existing.toObject(), ...req.body }, req.userId);
  await assertRefs(payload, req.userId);
  const preset = await QuickAddPreset.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, payload, { new: true, runValidators: true });
  successResponse(res, preset, "Quick add preset updated");
});

export const useQuickAddPreset = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) throw new ApiError("Invalid preset id", 400);
  const preset = await populate(
    QuickAddPreset.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId, isActive: true },
      { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
      { new: true }
    )
  );
  if (!preset) throw new ApiError("Quick add preset not found", 404);
  successResponse(res, preset, "Quick add preset used");
});

export const deleteQuickAddPreset = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) throw new ApiError("Invalid preset id", 400);
  const preset = await QuickAddPreset.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { isActive: false }, { new: true });
  if (!preset) throw new ApiError("Quick add preset not found", 404);
  successResponse(res, preset, "Quick add preset removed");
});
