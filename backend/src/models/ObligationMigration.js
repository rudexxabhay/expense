import mongoose from "mongoose";

const obligationMigrationSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  completedAt: { type: Date, required: true },
  createdBy: { type: String, required: true }
}, { timestamps: true });

export default mongoose.model("ObligationMigration", obligationMigrationSchema);
