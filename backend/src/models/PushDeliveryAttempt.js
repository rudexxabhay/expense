import mongoose from "mongoose";

const pushDeliveryAttemptSchema = new mongoose.Schema({
  userId: { type: String, required: true, trim: true, index: true },
  notification: { type: mongoose.Schema.Types.ObjectId, ref: "Notification", required: true, index: true },
  subscription: { type: mongoose.Schema.Types.ObjectId, ref: "PushSubscription", required: true, index: true },
  attempt: { type: Number, required: true, min: 1 },
  status: { type: String, required: true, enum: ["SENT", "FAILED", "DISABLED"] },
  sentAt: Date,
  errorCode: { type: String, trim: true },
  errorMessage: { type: String, trim: true, maxlength: 500 }
}, { timestamps: true });

pushDeliveryAttemptSchema.index({ userId: 1, notification: 1, subscription: 1, attempt: 1 });

export default mongoose.model("PushDeliveryAttempt", pushDeliveryAttemptSchema);
