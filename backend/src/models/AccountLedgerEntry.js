import mongoose from "mongoose";

const accountLedgerEntrySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true, index: true },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", index: true },
    settlement: { type: mongoose.Schema.Types.ObjectId, ref: "Settlement", index: true },
    requestKey: { type: String, trim: true },
    delta: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    operation: { type: String, enum: ["POSTED", "REVERSAL"], required: true },
    createdBy: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

accountLedgerEntrySchema.pre("validate", function validateSource(next) {
  if (!this.transaction && !this.settlement) return next(new Error("A ledger entry must reference a transaction or settlement"));
  next();
});

accountLedgerEntrySchema.index({ userId: 1, account: 1, createdAt: 1 });
accountLedgerEntrySchema.index({ userId: 1, transaction: 1, createdAt: 1 });

export default mongoose.model("AccountLedgerEntry", accountLedgerEntrySchema);
