import mongoose from "mongoose";

const pushSubscriptionSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  endpoint: { type: String, required: true },
  keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
  deviceId: { type: String, trim: true, maxlength: 160 },
  deviceLabel: { type: String, trim: true, maxlength: 120 },
  deviceName: { type: String, trim: true, maxlength: 120 },
  platform: { type: String, trim: true, maxlength: 80 },
  lastUsedAt: Date,
  lastSuccessAt: Date,
  lastFailureAt: Date,
  failureCount: { type: Number, default: 0, min: 0 },
  lastErrorCode: { type: String, trim: true },
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });

pushSubscriptionSchema.index({ userId: 1, endpoint: 1 }, { unique: true });
pushSubscriptionSchema.index({ userId: 1, isActive: 1 });
export default mongoose.model("PushSubscription", pushSubscriptionSchema);
