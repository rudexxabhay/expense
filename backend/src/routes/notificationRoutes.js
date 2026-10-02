import express from "express";
import {
  archiveNotification,
  completeNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  pushConfig,
  savePushSubscription,
  removePushSubscription,
  pushStatus
} from "../controllers/notificationController.js";

const router = express.Router();

router.get("/", listNotifications);
router.get("/push/config", pushConfig);
router.get("/push/status", pushStatus);
router.post("/push/subscriptions", savePushSubscription);
router.delete("/push/subscriptions", removePushSubscription);
router.patch("/read-all", markAllNotificationsRead);
router.patch("/:id/read", markNotificationRead);
router.patch("/:id/complete", completeNotification);
router.delete("/:id", archiveNotification);

export default router;
