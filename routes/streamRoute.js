const express = require("express");
const { getAudioStream, resetQueue } = require("../controllers/streamcontroller");
const router = express.Router();

router.get("/audio-stream", getAudioStream);
router.get("/reset-queue", resetQueue);
router.post("/reset-queue", resetQueue);

module.exports = router;
