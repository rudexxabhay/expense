import express from "express";
import {
  createQuickAddPreset,
  deleteQuickAddPreset,
  listQuickAddPresets,
  useQuickAddPreset,
  updateQuickAddPreset
} from "../controllers/quickAddController.js";

const router = express.Router();

router.get("/", listQuickAddPresets);
router.post("/", createQuickAddPreset);
router.post("/:id/use", useQuickAddPreset);
router.put("/:id", updateQuickAddPreset);
router.delete("/:id", deleteQuickAddPreset);

export default router;
