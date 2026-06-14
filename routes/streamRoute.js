const express = require("express");
const { getAudioStream, resetQueue, getConnectAudio } = require("../controllers/streamcontroller");
const router = express.Router();

router.get("/audio-stream", getAudioStream);
router.get("/reset-queue", resetQueue);
router.post("/reset-queue", resetQueue);
router.get("/connect-audio", getConnectAudio);

module.exports = router;
