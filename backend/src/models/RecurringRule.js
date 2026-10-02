import mongoose from "mongoose";

const recurringRuleSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, required: true, enum: ["INCOME", "EXPENSE"] },
    amount: { type: Number, required: true, min: 0.01 },
    account: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag" }],
    note: { type: String, trim: true, maxlength: 500 },
    frequency: { type: String, required: true, enum: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "CUSTOM"] },
    interval: { type: Number, min: 1, max: 365, default: 1 },
    startDate: { type: Date, required: true },
    nextRunDate: { type: Date, required: true, index: true },
    endDate: { type: Date },
    transactionTime: { type: String, default: "09:00", match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    reminderEnabled: { type: Boolean, default: false },
    reminderStartDaysBefore: { type: Number, min: 0, max: 30, default: 3 },
    reminderTimes: {
      type: [String],
      default: ["09:00", "14:00", "20:00"],
      validate: {
        validator(times) {
          return times.length <= 3 && times.every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
        },
        message: "Reminder times must be valid HH:mm values and limited to 3 per day"
      }
    },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

recurringRuleSchema.index({ userId: 1, isActive: 1, nextRunDate: 1 });

export default mongoose.model("RecurringRule", recurringRuleSchema);
