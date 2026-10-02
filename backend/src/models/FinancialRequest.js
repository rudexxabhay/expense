import mongoose from "mongoose";

const financialRequestSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    requestKey: { type: String, required: true },
    payloadHash: { type: String, required: true },
    transactionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Transaction" }],
    createdBy: { type: String, required: true }
  },
  { timestamps: true }
);

financialRequestSchema.index({ userId: 1, requestKey: 1 }, { unique: true });

export default mongoose.model("FinancialRequest", financialRequestSchema);
