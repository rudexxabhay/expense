import express from "express";
import {
  archiveNotification,
  completeNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  pushConfig,
  disablePushDevice,
  getNotificationSettings,
  listPushDevices,
  savePushSubscription,
  sendTestPush,
  removePushSubscription,
  pushStatus,
  updateNotificationSettings
} from "../controllers/notificationController.js";

const router = express.Router();

router.get("/", listNotifications);
router.get("/push/config", pushConfig);
router.get("/push/status", pushStatus);
router.get("/push/devices", listPushDevices);
router.post("/push/subscriptions", savePushSubscription);
router.delete("/push/subscriptions", removePushSubscription);
router.post("/test-push", sendTestPush);
router.post("/push/test", sendTestPush);
router.delete("/push/devices/:id", disablePushDevice);
router.get("/settings", getNotificationSettings);
router.patch("/settings", updateNotificationSettings);
router.patch("/read-all", markAllNotificationsRead);
router.patch("/:id/read", markNotificationRead);
router.patch("/:id/complete", completeNotification);
router.delete("/:id", archiveNotification);

export default router;
