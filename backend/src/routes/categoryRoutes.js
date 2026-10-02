import express from "express";
import categoryController from "../controllers/categoryController.js";
import validateRequest from "../middleware/validateRequest.js";

const router = express.Router();

const categorySchema = {
  name: { required: true, maxLength: 80 },
  type: { required: true, enum: ["EXPENSE", "INCOME"] },
  icon: { maxLength: 50 },
  color: { maxLength: 30 },
  isDefault: { type: "boolean" },
  isActive: { type: "boolean" }
};

router.route("/").get(categoryController.list).post(validateRequest(categorySchema), categoryController.create);
router
  .route("/:id")
  .get(categoryController.getById)
  .put(validateRequest(categorySchema), categoryController.update)
  .delete(categoryController.deactivate);

export default router;
