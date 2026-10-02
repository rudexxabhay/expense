import express from "express";
import {
  exportFullBackup,
  exportTransactionsCsv,
  previewImport,
  restoreBackup
} from "../controllers/backupController.js";

const router = express.Router();

router.get("/transactions.csv", exportTransactionsCsv);
router.get("/full.json", exportFullBackup);
router.post("/import/preview", previewImport);
router.post("/import/restore", restoreBackup);

export default router;
