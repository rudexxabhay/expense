import mongoose from "mongoose";

const settlementSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    person: { type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true, index: true },
    sourceTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    repaymentTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    direction: { type: String, required: true, enum: ["PAYMENT", "RECEIPT", "PAID_BY_ME", "RECEIVED_BY_ME"] },
    amount: { type: Number, required: true, min: 0.01 },
    totalAmount: { type: Number, min: 0.01 },
    account: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
    settlementDate: { type: Date, required: true },
    settlementTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    note: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: ["ACTIVE", "CANCELLED"], default: "ACTIVE" },
    requestKey: { type: String, trim: true },
    createdBy: { type: String },
    version: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

settlementSchema.index({ userId: 1, person: 1, settlementDate: -1 });
settlementSchema.index({ userId: 1, requestKey: 1 }, { unique: true, partialFilterExpression: { requestKey: { $exists: true } } });

export default mongoose.model("Settlement", settlementSchema);
