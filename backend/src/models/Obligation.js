import mongoose from "mongoose";

const obligationSchema = new mongoose.Schema({
  userId: { type: String, required: true, trim: true, index: true },
  sourceTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", required: true, index: true },
  person: { type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true, index: true },
  direction: { type: String, required: true, enum: ["PAYABLE", "RECEIVABLE"], index: true },
  sourceType: { type: String, required: true, enum: ["BORROW", "LEND", "PAID_FOR_SOMEONE", "PAID_BY_SOMEONE", "SPLIT_SHARE"] },
  originalAmount: { type: Number, required: true, min: 0.01 },
  settledAmount: { type: Number, required: true, min: 0, default: 0 },
  remainingAmount: { type: Number, required: true, min: 0 },
  dueDate: Date,
  status: { type: String, required: true, enum: ["PENDING", "PARTIALLY_SETTLED", "SETTLED", "OVERDUE", "CANCELLED"], default: "PENDING", index: true },
  settledAt: Date,
  version: { type: Number, default: 0, min: 0 },
  createdBy: { type: String, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

obligationSchema.index({ userId: 1, sourceTransaction: 1 }, { unique: true });
obligationSchema.index({ userId: 1, direction: 1, status: 1, dueDate: 1 });

export default mongoose.model("Obligation", obligationSchema);
