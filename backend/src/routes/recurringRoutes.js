import express from "express";
import {
  createRecurringRule,
  deleteRecurringRule,
  listRecurringRules,
  runRecurringRules,
  updateRecurringRule
} from "../controllers/recurringController.js";

const router = express.Router();

router.get("/", listRecurringRules);
router.post("/run", runRecurringRules);
router.post("/", createRecurringRule);
router.put("/:id", updateRecurringRule);
router.delete("/:id", deleteRecurringRule);

export default router;
