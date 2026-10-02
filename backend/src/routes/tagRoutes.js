import express from "express";
import tagController from "../controllers/tagController.js";
import validateRequest from "../middleware/validateRequest.js";

const router = express.Router();

const tagSchema = {
  name: { required: true, maxLength: 50 },
  color: { maxLength: 30 }
};

router.route("/").get(tagController.list).post(validateRequest(tagSchema), tagController.create);
router
  .route("/:id")
  .get(tagController.getById)
  .put(validateRequest(tagSchema), tagController.update)
  .delete(tagController.deactivate);

export default router;
