import express from "express";
import personController from "../controllers/personController.js";
import { getPersonLedger } from "../controllers/transactionController.js";
import validateRequest from "../middleware/validateRequest.js";

const router = express.Router();

const personSchema = {
  name: { required: true, maxLength: 100 },
  phone: { maxLength: 30 },
  email: { maxLength: 120 },
  note: { maxLength: 300 },
  avatarColor: { maxLength: 30 },
  isActive: { type: "boolean" }
};

router.route("/").get(personController.list).post(validateRequest(personSchema), personController.create);
router.get("/:id/ledger", getPersonLedger);
router
  .route("/:id")
  .get(personController.getById)
  .put(validateRequest(personSchema), personController.update)
  .delete(personController.deactivate);

export default router;
