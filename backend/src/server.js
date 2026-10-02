import app from "./app.js";
import connectDatabase from "./config/database.js";
import { processScheduledNotifications } from "./controllers/notificationController.js";

const PORT = process.env.PORT || 5000;

connectDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API listening on port ${PORT}`);
    });
    const runReminders = () => processScheduledNotifications().catch((error) => {
      console.error("[reminders] scheduled processing failed", { name: error.name, code: error.code, message: error.message });
    });
    runReminders();
    setInterval(runReminders, 60_000).unref();
  })
  .catch((error) => {
    console.error("[database] startup failed", { name: error.name, code: error.code, message: error.message });
    process.exitCode = 1;
  });
