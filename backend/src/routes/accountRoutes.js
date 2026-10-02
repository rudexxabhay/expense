import express from "express";
import accountController, { getAccountLedger, reconcileAccounts } from "../controllers/accountController.js";
import validateRequest from "../middleware/validateRequest.js";

const router = express.Router();

const accountSchema = {
  name: { required: true, maxLength: 80 },
  type: { required: true, enum: ["CASH", "BANK", "WALLET", "CREDIT_CARD"] },
  currentBalance: { required: true, type: "number" },
  openingBalance: { required: true, type: "number" },
  icon: { maxLength: 50 },
  isActive: { type: "boolean" }
};

router.route("/").get(accountController.list).post(validateRequest(accountSchema), accountController.create);
router.get("/reconciliation", reconcileAccounts);
router.get("/:id/ledger", getAccountLedger);
router
  .route("/:id")
  .get(accountController.getById)
  .put(validateRequest(accountSchema), accountController.update)
  .delete(accountController.deactivate);

export default router;
