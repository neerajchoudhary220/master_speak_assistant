const express = require("express");
const { getAudioStream, resetQueue, getConnectAudio, getTestAudio, triggerTestAudio } = require("../controllers/streamcontroller");
const router = express.Router();

router.get("/audio-stream", getAudioStream);
router.get("/reset-queue", resetQueue);
router.post("/reset-queue", resetQueue);
router.get("/connect-audio", getConnectAudio);
router.get("/test-audio", getTestAudio);
router.get("/trigger-test", triggerTestAudio);

module.exports = router;
