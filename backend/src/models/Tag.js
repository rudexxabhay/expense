import mongoose from "mongoose";

const tagSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    color: { type: String, trim: true, default: "primary" }
  },
  { timestamps: true }
);

tagSchema.index({ userId: 1, name: 1 }, { unique: true });

export default mongoose.model("Tag", tagSchema);
