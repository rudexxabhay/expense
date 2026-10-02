import express from "express";
import { getActivityEvent, listActivityEvents } from "../controllers/activityController.js";

const router = express.Router();

router.get("/", listActivityEvents);
router.get("/:id", getActivityEvent);

export default router;
