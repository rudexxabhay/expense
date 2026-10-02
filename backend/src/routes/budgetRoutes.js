import express from "express";
import { createBudget, deleteBudget, listBudgets, updateBudget } from "../controllers/budgetController.js";

const router = express.Router();

router.get("/", listBudgets);
router.post("/", createBudget);
router.put("/:id", updateBudget);
router.delete("/:id", deleteBudget);

export default router;
