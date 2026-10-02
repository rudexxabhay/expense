import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    notificationKey: { type: String, required: true, trim: true },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    obligation: { type: mongoose.Schema.Types.ObjectId, ref: "Obligation", index: true },
    recurringRule: { type: mongoose.Schema.Types.ObjectId, ref: "RecurringRule" },
    templateKey: { type: String, trim: true },
    person: { type: mongoose.Schema.Types.ObjectId, ref: "Person" },
    personId: { type: mongoose.Schema.Types.ObjectId, ref: "Person" },
    remainingAmount: { type: Number, default: 0 },
    deliveryStatus: { type: String, enum: ["SCHEDULED", "PROCESSING", "PUSH_SENT", "PUSH_FAILED", "READ", "CANCELLED"], default: "SCHEDULED", index: true },
    scheduledFor: Date,
    sentAt: Date,
    readAt: Date,
    attempts: { type: Number, default: 0 },
    deliveredDevices: [{ type: mongoose.Schema.Types.ObjectId, ref: "PushSubscription" }],
    type: {
      type: String,
      required: true,
      enum: ["DUE_TODAY", "UPCOMING", "OVERDUE", "TO_RECEIVE", "TO_PAY", "RECURRING"]
    },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    message: { type: String, required: true, trim: true, maxlength: 300 },
    amount: { type: Number, default: 0 },
    dueDate: { type: Date },
    reminderAt: { type: Date },
    direction: { type: String, enum: ["RECEIVE", "PAY", "NONE"], default: "NONE" },
    status: { type: String, enum: ["UNREAD", "READ", "ARCHIVED"], default: "UNREAD", index: true }
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, notificationKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, status: 1, dueDate: 1 });
notificationSchema.index({ userId: 1, type: 1, status: 1 });

export default mongoose.model("Notification", notificationSchema);
