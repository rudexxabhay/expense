import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, required: true, enum: ["EXPENSE", "INCOME"] },
    icon: { type: String, trim: true, default: "Receipt" },
    color: { type: String, trim: true, default: "coral" },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

categorySchema.index({ userId: 1, name: 1, type: 1 }, { unique: true });

export default mongoose.model("Category", categorySchema);
