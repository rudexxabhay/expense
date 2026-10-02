import mongoose from "mongoose";

const pushSubscriptionSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
  deviceLabel: { type: String, trim: true, maxlength: 120 },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: Date,
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });

pushSubscriptionSchema.index({ userId: 1, isActive: 1 });
export default mongoose.model("PushSubscription", pushSubscriptionSchema);
