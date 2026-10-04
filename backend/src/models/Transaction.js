import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    createdBy: { type: String, trim: true },
    version: { type: Number, default: 0, min: 0 },
    requestKey: { type: String, trim: true },
    adjustmentDirection: { type: String, enum: ["INCREASE", "DECREASE"] },
    type: {
      type: String,
      required: true,
      enum: [
        "EXPENSE",
        "INCOME",
        "BORROW",
        "LEND",
        "PAID_FOR_SOMEONE",
        "PAID_BY_SOMEONE",
        "TRANSFER",
        "REPAYMENT_RECEIVED",
        "REPAYMENT_PAID",
        "SPLIT_EXPENSE",
        "BALANCE_ADJUSTMENT"
      ],
      index: true
    },
    amount: { type: Number, required: true, min: 0.01 },
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required() {
        const transactionType = typeof this.get === "function" ? this.get("type") : this.type;
        return transactionType !== "PAID_BY_SOMEONE";
      },
      index: true
    },
    destinationAccount: { type: mongoose.Schema.Types.ObjectId, ref: "Account" },
    person: { type: mongoose.Schema.Types.ObjectId, ref: "Person" },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag" }],
    note: { type: String, trim: true, maxlength: 500 },
    transactionDate: { type: Date, required: true, index: true },
    transactionTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    dueDate: { type: Date },
    status: { type: String, enum: ["ACTIVE", "CANCELLED"], default: "ACTIVE", index: true },
    originalAmount: { type: Number, min: 0 },
    remainingAmount: { type: Number, min: 0 },
    repaymentStatus: {
      type: String,
      enum: ["NONE", "PENDING", "PARTIAL", "PAID"],
      default: "NONE"
    },
    reminderEnabled: { type: Boolean, default: false },
    reminderStartDaysBefore: { type: Number, min: 0, max: 30, default: 3 },
    reminderTimes: {
      type: [String],
      default: ["09:00", "14:00", "19:00"],
      validate: {
        validator(times) {
          return times.length <= 3 && times.every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
        },
        message: "Reminder times must be valid HH:mm values and limited to 3 per day"
      }
    },
    parentTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    settlement: { type: mongoose.Schema.Types.ObjectId, ref: "Settlement" },
    recurringRule: { type: mongoose.Schema.Types.ObjectId, ref: "RecurringRule" },
    recurrenceKey: { type: String, trim: true },
    splitGroupId: { type: mongoose.Schema.Types.ObjectId },
    myShare: { type: Number, min: 0 },
    splitParticipants: [
      {
        person: { type: mongoose.Schema.Types.ObjectId, ref: "Person" },
        amount: { type: Number, min: 0 }
      }
    ]
  },
  { timestamps: true }
);

transactionSchema.index({ userId: 1, transactionDate: -1, createdAt: -1 });
transactionSchema.index({ userId: 1, type: 1, status: 1 });
transactionSchema.index({ userId: 1, person: 1 });
transactionSchema.index({ userId: 1, tags: 1 });
transactionSchema.index({ userId: 1, account: 1, transactionDate: -1 });
transactionSchema.index({ userId: 1, category: 1, transactionDate: -1 });
transactionSchema.index({ userId: 1, person: 1, transactionDate: -1 });
transactionSchema.index({ userId: 1, repaymentStatus: 1, dueDate: 1 });
transactionSchema.index({ userId: 1, status: 1, transactionDate: -1 });
transactionSchema.index(
  { userId: 1, recurringRule: 1, recurrenceKey: 1 },
  { unique: true, partialFilterExpression: { recurringRule: { $exists: true }, recurrenceKey: { $exists: true } } }
);

export default mongoose.model("Transaction", transactionSchema);
