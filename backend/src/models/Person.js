import mongoose from "mongoose";

const personSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 30 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 300 },
    avatarColor: { type: String, trim: true, default: "emerald" },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

personSchema.index({ userId: 1, name: 1 });

export default mongoose.model("Person", personSchema);
