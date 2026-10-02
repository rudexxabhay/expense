import mongoose from "mongoose";
import { errorResponse } from "../utils/apiResponse.js";

export function notFoundHandler(req, res) {
  return errorResponse(res, `Route not found: ${req.originalUrl}`, 404);
}

export function errorHandler(err, req, res, next) {
  if (err instanceof mongoose.Error.ValidationError) {
    const errors = Object.values(err.errors).map((item) => ({
      field: item.path,
      message: item.message
    }));
    return errorResponse(res, "Validation failed", 400, errors);
  }

  if (err instanceof mongoose.Error.CastError) {
    return errorResponse(res, "Invalid resource id", 400);
  }

  if (err.code === 11000) {
    if (err.keyPattern?.email || err.keyValue?.email) {
      return errorResponse(res, "An account already exists with this email. Login instead.", 409, [
        { field: "email", message: "An account already exists with this email. Login instead." }
      ]);
    }
    return errorResponse(res, "Duplicate value already exists", 409, err.keyValue);
  }

  const statusCode = err.statusCode || 500;
  if (statusCode >= 500) {
    console.error("[http] request failed", {
      method: req.method,
      path: req.path,
      statusCode,
      name: err.name,
      code: err.code,
      message: err.message
    });
  }
  const message = statusCode === 500 ? "Internal server error" : err.message;
  return errorResponse(res, message, statusCode, err.errors || null);
}
