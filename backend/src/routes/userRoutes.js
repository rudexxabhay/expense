import express from "express";
import { updatePreferences } from "../controllers/userController.js";

const router = express.Router();

router.patch("/preferences", updatePreferences);

export default router;
