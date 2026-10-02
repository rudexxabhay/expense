import mongoose from "mongoose";

const budgetSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    limitAmount: { type: Number, required: true, min: 0.01 },
    warningAtPercent: { type: Number, min: 1, max: 100, default: 80 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

budgetSchema.index({ userId: 1, category: 1, month: 1, year: 1 }, { unique: true });

export default mongoose.model("Budget", budgetSchema);
