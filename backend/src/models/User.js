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
      timezone: { type: String, trim: true, default: "Asia/Kolkata" },
      notifications: {
        pushEnabled: { type: Boolean, default: true },
        paymentReminders: { type: Boolean, default: true },
        receivableReminders: { type: Boolean, default: true },
        overdueReminders: { type: Boolean, default: true },
        settlementConfirmations: { type: Boolean, default: true },
        recurringReminders: { type: Boolean, default: true },
        reminderStartDaysBefore: { type: Number, min: 0, max: 30, default: 3 },
        reminderTimes: {
          type: [String],
          default: ["09:00", "14:00", "19:00"],
          validate: {
            validator(times) {
              return times.length <= 3 && times.every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
            },
            message: "Reminder times must be valid HH:mm values and limited to 3 per day"
          }
        },
        preview: { type: String, enum: ["DETAILED", "PRIVATE"], default: "DETAILED" }
      }
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
