import mongoose from "mongoose";

const activityEventSchema = new mongoose.Schema({
  userId: { type: String, required: true, trim: true, index: true },
  eventKey: { type: String, required: true, trim: true },
  eventType: {
    type: String,
    required: true,
    enum: [
      "TRANSACTION_CREATED",
      "TRANSACTION_UPDATED",
      "TRANSACTION_CANCELLED",
      "SETTLEMENT_ALLOCATED",
      "SETTLEMENT_REVERSED",
      "OBLIGATION_STATUS_CHANGED"
    ],
    index: true
  },
  systemLabel: { type: String, required: true, trim: true },
  rootTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", index: true },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", index: true },
  obligation: { type: mongoose.Schema.Types.ObjectId, ref: "Obligation", index: true },
  settlement: { type: mongoose.Schema.Types.ObjectId, ref: "Settlement", index: true },
  allocation: { type: mongoose.Schema.Types.ObjectId, ref: "SettlementAllocation", index: true },
  person: { type: mongoose.Schema.Types.ObjectId, ref: "Person", index: true },
  account: { type: mongoose.Schema.Types.ObjectId, ref: "Account", index: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", index: true },
  tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag", index: true }],
  amount: { type: Number, min: 0 },
  direction: { type: String, enum: ["IN", "OUT", "NEUTRAL", "PAYABLE", "RECEIVABLE"] },
  title: { type: String, required: true, trim: true },
  subtitle: { type: String, trim: true },
  note: { type: String, trim: true },
  occurredAt: { type: Date, required: true, index: true },
  originalAmount: Number,
  amountSettledThisEvent: Number,
  totalSettledBefore: Number,
  totalSettledAfter: Number,
  remainingBefore: Number,
  remainingAfter: Number,
  statusBefore: String,
  statusAfter: String,
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy: { type: String, required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });

activityEventSchema.index({ userId: 1, eventKey: 1 }, { unique: true });
activityEventSchema.index({ userId: 1, occurredAt: -1, createdAt: -1 });
activityEventSchema.index({ userId: 1, rootTransaction: 1, occurredAt: 1 });
activityEventSchema.index({ userId: 1, obligation: 1, occurredAt: 1 });
activityEventSchema.index({ userId: 1, settlement: 1, occurredAt: 1 });

export default mongoose.model("ActivityEvent", activityEventSchema);
