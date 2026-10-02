import express from "express";
import { cancelSettlement, createSettlement, getObligation, listObligations, listSettlementHistory } from "../controllers/obligationController.js";

const router = express.Router();

router.get("/", listObligations);
router.get("/history", listSettlementHistory);
router.post("/settlements", createSettlement);
router.patch("/settlements/:id/reverse", cancelSettlement);
router.post("/:id/settlements", createSettlement);
router.get("/:id", getObligation);

export default router;
