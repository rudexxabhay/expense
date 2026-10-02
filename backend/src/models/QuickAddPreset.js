import mongoose from "mongoose";

const quickAddPresetSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, required: true, enum: ["EXPENSE", "INCOME"] },
    amount: { type: Number, min: 0.01 },
    account: { type: mongoose.Schema.Types.ObjectId, ref: "Account" },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag" }],
    note: { type: String, trim: true, maxlength: 300 },
    presetGroup: { type: String, trim: true, maxlength: 60, default: "Custom" },
    icon: { type: String, trim: true, maxlength: 24, default: "Receipt" },
    favorite: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
    usageCount: { type: Number, default: 0, min: 0 },
    lastUsedAt: { type: Date },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

quickAddPresetSchema.index({ userId: 1, name: 1 }, { unique: true });
quickAddPresetSchema.index({ userId: 1, favorite: -1, lastUsedAt: -1, usageCount: -1 });

export default mongoose.model("QuickAddPreset", quickAddPresetSchema);
