import express from "express";
import { exportExcelReport, exportPdfReport } from "../controllers/reportExportController.js";

const router = express.Router();

router.get("/export.pdf", exportPdfReport);
router.get("/export.xlsx", exportExcelReport);

export default router;
