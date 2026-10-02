import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 140 },
    passwordHash: { type: String, required: true },
    sessionVersion: { type: Number, default: 0 },
    refreshSessions: [{
      tokenHash: { type: String, required: true },
      previousTokenHash: { type: String },
      previousValidUntil: { type: Date },
      expiresAt: { type: Date, required: true },
      createdAt: { type: Date, default: Date.now }
    }],
    avatarColor: { type: String, trim: true, default: "primary" },
    initials: { type: String, trim: true, maxlength: 4 },
    preferences: {
      theme: {
        type: String,
        enum: ["indigo", "blue", "emerald", "teal", "rose", "amber", "purple"],
        default: "indigo"
      },
      timezone: { type: String, trim: true, default: "Asia/Kolkata" }
    }
  },
  { timestamps: true }
);

userSchema.pre("save", function invalidateSessionsOnPasswordChange() {
  if (!this.isNew && this.isModified("passwordHash")) {
    this.sessionVersion = Number(this.sessionVersion || 0) + 1;
    this.refreshSessions = [];
  }
});

userSchema.pre(["findOneAndUpdate", "updateOne"], function invalidateSessionsOnPasswordUpdate() {
  const update = this.getUpdate() || {};
  const passwordHash = update.passwordHash || update.$set?.passwordHash;
  if (!passwordHash) return;
  const set = { ...(update.$set || {}), refreshSessions: [] };
  if (update.passwordHash) {
    set.passwordHash = update.passwordHash;
    delete update.passwordHash;
  }
  update.$set = set;
  update.$inc = { ...(update.$inc || {}), sessionVersion: 1 };
  this.setUpdate(update);
});

export default mongoose.model("User", userSchema);
