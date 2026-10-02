import mongoose from "mongoose";

const obligationEventSchema = new mongoose.Schema({
  userId: { type: String, required: true, trim: true, index: true },
  obligation: { type: mongoose.Schema.Types.ObjectId, ref: "Obligation", required: true, index: true },
  sourceTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
  settlement: { type: mongoose.Schema.Types.ObjectId, ref: "Settlement" },
  allocation: { type: mongoose.Schema.Types.ObjectId, ref: "SettlementAllocation" },
  eventType: { type: String, required: true, enum: ["CREATED", "SETTLEMENT_ALLOCATED", "SETTLEMENT_REVERSED", "CANCELLED", "CORRECTED"] },
  amount: { type: Number, min: 0 },
  statusBefore: String,
  statusAfter: String,
  remainingBefore: Number,
  remainingAfter: Number,
  createdBy: { type: String, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: { createdAt: true, updatedAt: false } });

obligationEventSchema.index({ userId: 1, obligation: 1, createdAt: 1 });
obligationEventSchema.index(
  { userId: 1, allocation: 1 },
  { unique: true, partialFilterExpression: { allocation: { $exists: true }, eventType: "SETTLEMENT_ALLOCATED" } }
);

export default mongoose.model("ObligationEvent", obligationEventSchema);
