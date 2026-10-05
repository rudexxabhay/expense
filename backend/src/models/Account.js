import mongoose from "mongoose";

const accountSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: {
      type: String,
      required: true,
      enum: ["CASH", "BANK", "WALLET", "CREDIT_CARD"]
    },
    currentBalance: { type: Number, required: true, default: 0 },
    openingBalance: { type: Number, required: true, default: 0 },
    icon: { type: String, trim: true, default: "Wallet" },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

accountSchema.index({ userId: 1, name: 1, type: 1 }, { unique: true });
accountSchema.index({ userId: 1, isActive: 1, type: 1 });

export default mongoose.model("Account", accountSchema);
