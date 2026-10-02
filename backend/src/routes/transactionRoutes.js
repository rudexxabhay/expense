import express from "express";
import {
  cancelTransaction,
  createTransaction,
  createSplitExpense,
  getTransactionById,
  getTransactionReports,
  getTransactionSummary,
  listTransactions,
  settleTransaction,
  updateTransaction
} from "../controllers/transactionController.js";

const router = express.Router();

router.get("/summary", getTransactionSummary);
router.get("/reports", getTransactionReports);
router.post("/split", createSplitExpense);
router.route("/").get(listTransactions).post(createTransaction);
router.post("/:id/settle", settleTransaction);
router.route("/:id").get(getTransactionById).put(updateTransaction).delete(cancelTransaction);

export default router;
