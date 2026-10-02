import mongoose from "mongoose";

const transactionAuditSchema = new mongoose.Schema({
  userId: { type: String, required: true, trim: true, index: true },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", required: true, index: true },
  action: { type: String, required: true, enum: ["UPDATED", "CANCELLED", "REVERSED"] },
  version: { type: Number, required: true },
  before: { type: mongoose.Schema.Types.Mixed, required: true },
  after: { type: mongoose.Schema.Types.Mixed },
  createdBy: { type: String, required: true },
  requestKey: { type: String }
}, { timestamps: { createdAt: true, updatedAt: false } });

transactionAuditSchema.index({ userId: 1, transaction: 1, createdAt: 1 });

export default mongoose.model("TransactionAudit", transactionAuditSchema);
