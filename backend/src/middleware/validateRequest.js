import ApiError from "../utils/ApiError.js";

export default function validateRequest(schema) {
  return (req, res, next) => {
    const errors = [];

    Object.entries(schema).forEach(([field, rules]) => {
      const value = req.body[field];
      const isMissing = value === undefined || value === null || value === "";

      if (rules.required && isMissing) {
        errors.push({ field, message: `${field} is required` });
        return;
      }

      if (isMissing) return;

      if (rules.type === "number" && Number.isNaN(Number(value))) {
        errors.push({ field, message: `${field} must be a number` });
      }

      if (rules.type === "boolean" && typeof value !== "boolean") {
        errors.push({ field, message: `${field} must be true or false` });
      }

      if (rules.enum && !rules.enum.includes(value)) {
        errors.push({ field, message: `${field} must be one of: ${rules.enum.join(", ")}` });
      }

      if (rules.maxLength && String(value).trim().length > rules.maxLength) {
        errors.push({ field, message: `${field} must be ${rules.maxLength} characters or less` });
      }

      if (rules.min !== undefined && Number(value) < rules.min) {
        errors.push({ field, message: `${field} must be at least ${rules.min}` });
      }
    });

    if (errors.length) {
      return next(new ApiError("Validation failed", 400, errors));
    }

    next();
  };
}
