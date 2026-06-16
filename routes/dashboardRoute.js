const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardcontroller");

// Route to get overall status
router.get("/status", dashboardController.getStatus);

// Routes for Price Alerts
router.get("/alerts", dashboardController.getAlerts);
router.post("/alerts", dashboardController.createAlert);
router.delete("/alerts/:id", dashboardController.deleteAlert);

// Routes for Reminders
router.get("/reminders", dashboardController.getReminders);
router.post("/reminders", dashboardController.createReminder);
router.delete("/reminders/:id", dashboardController.deleteReminder);

// Route for Text-to-Speech
router.post("/speak", dashboardController.postSpeak);

// Route to clear queue
router.post("/clear", dashboardController.postClear);

// Route to upload recorded audio (browser microphone)
router.post(
  "/upload-audio",
  express.raw({ type: "audio/*", limit: "10mb" }),
  dashboardController.postUploadAudio
);

module.exports = router;
