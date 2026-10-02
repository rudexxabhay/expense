import mongoose from "mongoose";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { successResponse } from "../utils/apiResponse.js";

function assertValidId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError("Invalid resource id", 400);
  }
}

export function createCrudController(Model, resourceName, options = {}) {
  const hasIsActive = options.hasIsActive !== false;

  const list = asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === "true";
    const query = { userId: req.userId };
    if (hasIsActive && !includeInactive) query.isActive = true;
    const items = await Model.find(query).sort({ createdAt: -1 });
    successResponse(res, items, `${resourceName} list fetched`);
  });

  const create = asyncHandler(async (req, res) => {
    const item = await Model.create({ ...req.body, userId: req.userId });
    successResponse(res, item, `${resourceName} created`, 201);
  });

  const getById = asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const item = await Model.findOne({ _id: req.params.id, userId: req.userId });

    if (!item || (hasIsActive && item.isActive === false)) {
      throw new ApiError(`${resourceName} not found`, 404);
    }

    successResponse(res, item, `${resourceName} fetched`);
  });

  const update = asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const item = await Model.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, req.body, {
      new: true,
      runValidators: true
    });

    if (!item || (hasIsActive && item.isActive === false)) {
      throw new ApiError(`${resourceName} not found`, 404);
    }

    successResponse(res, item, `${resourceName} updated`);
  });

  const deactivate = asyncHandler(async (req, res) => {
    assertValidId(req.params.id);

    if (hasIsActive) {
      const item = await Model.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId },
        { isActive: false },
        { new: true, runValidators: true }
      );

      if (!item) {
        throw new ApiError(`${resourceName} not found`, 404);
      }

      successResponse(res, item, `${resourceName} deactivated`);
      return;
    }

    const item = await Model.findOneAndDelete({ _id: req.params.id, userId: req.userId });

    if (!item) {
      throw new ApiError(`${resourceName} not found`, 404);
    }

    successResponse(res, item, `${resourceName} deleted`);
  });

  return {
    list,
    create,
    getById,
    update,
    deactivate
  };
}
