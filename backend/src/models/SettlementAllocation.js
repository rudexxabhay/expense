import mongoose from "mongoose";

const settlementAllocationSchema = new mongoose.Schema({
  userId: { type: String, required: true, trim: true, index: true },
  settlement: { type: mongoose.Schema.Types.ObjectId, ref: "Settlement", required: true, index: true },
  obligation: { type: mongoose.Schema.Types.ObjectId, ref: "Obligation", required: true, index: true },
  amount: { type: Number, required: true, min: 0.01 },
  createdBy: { type: String, required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });

settlementAllocationSchema.index({ userId: 1, settlement: 1, obligation: 1 }, { unique: true });
settlementAllocationSchema.index({ userId: 1, obligation: 1, createdAt: 1 });

export default mongoose.model("SettlementAllocation", settlementAllocationSchema);
