import User from "../models/User.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { successResponse } from "../utils/apiResponse.js";

const themes = ["indigo", "blue", "emerald", "teal", "rose", "amber", "purple"];

export const updatePreferences = asyncHandler(async (req, res) => {
  const { theme } = req.body;
  const { timezone } = req.body;

  if (theme !== undefined && !themes.includes(theme)) {
    throw new ApiError("Invalid theme", 400);
  }
  if (timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      throw new ApiError("Invalid timezone", 400);
    }
  }
  const updates = {};
  if (theme !== undefined) updates["preferences.theme"] = theme;
  if (timezone !== undefined) updates["preferences.timezone"] = timezone;
  if (!Object.keys(updates).length) throw new ApiError("No preferences provided", 400);

  const user = await User.findByIdAndUpdate(
    req.userId,
    { $set: updates },
    { new: true, runValidators: true }
  ).select("-passwordHash");
  if (!user) throw new ApiError("User not found", 404);

  successResponse(
    res,
    {
      id: user._id,
      name: user.name,
      email: user.email,
      initials: user.initials,
      avatarColor: user.avatarColor,
      preferences: {
        theme: user.preferences?.theme,
        timezone: user.preferences?.timezone,
        notifications: user.preferences?.notifications
      }
    },
    "Preferences updated"
  );
});
