import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    notificationKey: { type: String, required: true, trim: true },
    dedupeKey: { type: String, trim: true, index: true },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    sourceTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    obligation: { type: mongoose.Schema.Types.ObjectId, ref: "Obligation", index: true },
    obligationId: { type: mongoose.Schema.Types.ObjectId, ref: "Obligation" },
    settlementId: { type: mongoose.Schema.Types.ObjectId, ref: "Settlement" },
    recurringRule: { type: mongoose.Schema.Types.ObjectId, ref: "RecurringRule" },
    templateKey: { type: String, trim: true },
    person: { type: mongoose.Schema.Types.ObjectId, ref: "Person" },
    personId: { type: mongoose.Schema.Types.ObjectId, ref: "Person" },
    remainingAmount: { type: Number, default: 0 },
    deliveryStatus: { type: String, enum: ["SCHEDULED", "QUEUED", "PROCESSING", "SENT", "FAILED", "PUSH_SENT", "PUSH_FAILED", "READ", "CANCELLED"], default: "SCHEDULED", index: true },
    scheduledFor: Date,
    sentAt: Date,
    readAt: Date,
    attempts: { type: Number, default: 0 },
    attemptCount: { type: Number, default: 0 },
    lastAttemptAt: Date,
    nextAttemptAt: Date,
    lastError: { type: String, trim: true, maxlength: 500 },
    deliveredDevices: [{ type: mongoose.Schema.Types.ObjectId, ref: "PushSubscription" }],
    type: {
      type: String,
      required: true,
      enum: [
        "DUE_TODAY",
        "UPCOMING",
        "OVERDUE",
        "TO_RECEIVE",
        "TO_PAY",
        "RECURRING",
        "PAYMENT_DUE_SOON",
        "PAYMENT_DUE_TODAY",
        "PAYMENT_OVERDUE",
        "RECEIVABLE_DUE_SOON",
        "RECEIVABLE_DUE_TODAY",
        "RECEIVABLE_OVERDUE",
        "PAYMENT_COMPLETED",
        "PAYMENT_RECEIVED",
        "PARTIAL_PAYMENT",
        "PARTIAL_RECEIPT",
        "LOAN_REPAYMENT_DUE",
        "RECURRING_EXPENSE_REMINDER",
        "GENERAL_FINANCIAL_REMINDER"
      ]
    },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    message: { type: String, required: true, trim: true, maxlength: 300 },
    body: { type: String, trim: true, maxlength: 300 },
    deepLink: { type: String, trim: true, maxlength: 500 },
    amount: { type: Number, default: 0 },
    dueDate: { type: Date },
    reminderAt: { type: Date },
    direction: { type: String, enum: ["RECEIVE", "PAY", "NONE"], default: "NONE" },
    status: { type: String, enum: ["UNREAD", "READ", "ARCHIVED"], default: "UNREAD", index: true }
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, notificationKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $exists: true } } });
notificationSchema.index({ userId: 1, status: 1, dueDate: 1 });
notificationSchema.index({ userId: 1, type: 1, status: 1 });
notificationSchema.index({ deliveryStatus: 1, nextAttemptAt: 1, reminderAt: 1 });

export default mongoose.model("Notification", notificationSchema);
