const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { selectAudioForSpeak, selectAudioForReminder, queueAudio } = require("../generate_audio_files/audio");
const { verifySymbolAndGetPrice } = require("../bots/crypto");
const { clearQueueAndStop } = require("./streamcontroller");

const TRIGGERS_FILE = path.join(__dirname, "../assets/json/triggers.json");
const REMINDERS_FILE = path.join(__dirname, "../assets/json/reminders.json");
const QUEUE_FILE = path.join(__dirname, "../assets/json/audioQueue.json");

// Helper to read JSON safely
const readJsonFile = (filePath, defaultVal = []) => {
  try {
    if (!fs.existsSync(filePath)) {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(defaultVal, null, 2), "utf8");
      return defaultVal;
    }
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (e) {
    console.error(`Error reading file ${filePath}:`, e.message);
    return defaultVal;
  }
};

// Helper to write JSON safely
const writeJsonFile = (filePath, data) => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error(`Error writing file ${filePath}:`, e.message);
  }
};

// GET /api/dashboard/status
exports.getStatus = (req, res) => {
  try {
    const queueData = readJsonFile(QUEUE_FILE, { queue: [] });
    const alerts = readJsonFile(TRIGGERS_FILE, []);
    const reminders = readJsonFile(REMINDERS_FILE, []);

    res.json({
      success: true,
      status: {
        wsClients: global.wsClients ? global.wsClients.size : 0,
        queueLength: queueData.queue ? queueData.queue.length : 0,
        alertsCount: alerts.length,
        remindersCount: reminders.length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/dashboard/alerts
exports.getAlerts = (req, res) => {
  try {
    const alerts = readJsonFile(TRIGGERS_FILE, []);
    res.json({ success: true, alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/dashboard/alerts
exports.createAlert = async (req, res) => {
  try {
    let { symbol, targetPrice, direction } = req.body;
    if (!symbol || !targetPrice) {
      return res.status(400).json({ success: false, error: "Symbol and targetPrice are required." });
    }

    symbol = symbol.toUpperCase().trim();
    const price = parseFloat(targetPrice);
    if (isNaN(price)) {
      return res.status(400).json({ success: false, error: "Invalid target price." });
    }

    if (!direction) {
      direction = "above";
    }

    // Verify symbol via MEXC
    const currentPrice = await verifySymbolAndGetPrice(symbol);
    if (currentPrice === null) {
      return res.status(400).json({ success: false, error: `Symbol '${symbol}' not found on MEXC Spot.` });
    }

    const alerts = readJsonFile(TRIGGERS_FILE, []);
    const newAlert = {
      id: Date.now().toString(),
      symbol,
      targetPrice: price,
      direction,
      chatId: process.env.TELEGRAM_CHAT_ID || "dashboard",
      createdAt: new Date().toISOString()
    };

    alerts.push(newAlert);
    writeJsonFile(TRIGGERS_FILE, alerts);

    res.json({ success: true, alert: newAlert, currentPrice });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// DELETE /api/dashboard/alerts/:id
exports.deleteAlert = (req, res) => {
  try {
    const { id } = req.params;
    const alerts = readJsonFile(TRIGGERS_FILE, []);
    const index = alerts.findIndex(a => a.id === id);

    if (index === -1) {
      return res.status(444).json({ success: false, error: "Alert not found." });
    }

    alerts.splice(index, 1);
    writeJsonFile(TRIGGERS_FILE, alerts);

    res.json({ success: true, message: "Alert deleted successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/dashboard/reminders
exports.getReminders = (req, res) => {
  try {
    const reminders = readJsonFile(REMINDERS_FILE, []);
    res.json({ success: true, reminders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/dashboard/reminders
exports.createReminder = (req, res) => {
  try {
    const { note, time, type, filePath } = req.body;
    if (!time) {
      return res.status(400).json({ success: false, error: "Reminder time is required." });
    }

    const reminderDate = new Date(time);
    if (isNaN(reminderDate.getTime())) {
      return res.status(400).json({ success: false, error: "Invalid date format." });
    }

    const reminders = readJsonFile(REMINDERS_FILE, []);
    const newReminder = {
      id: Date.now().toString() + "_" + Math.random().toString(36).substr(2, 5),
      chatId: process.env.TELEGRAM_CHAT_ID || "dashboard",
      type: type || "text",
      filePath: filePath || null,
      note: note || (type === "voice" ? "[Voice Reminder]" : ""),
      time: reminderDate.toISOString(),
      createdAt: new Date().toISOString()
    };

    reminders.push(newReminder);
    writeJsonFile(REMINDERS_FILE, reminders);

    res.json({ success: true, reminder: newReminder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// DELETE /api/dashboard/reminders/:id
exports.deleteReminder = (req, res) => {
  try {
    const { id } = req.params;
    const reminders = readJsonFile(REMINDERS_FILE, []);
    const index = reminders.findIndex(r => r.id === id);

    if (index === -1) {
      return res.status(444).json({ success: false, error: "Reminder not found." });
    }

    const reminder = reminders[index];
    // Delete associated voice file if it exists
    if (reminder.filePath && fs.existsSync(reminder.filePath)) {
      try {
        fs.unlinkSync(reminder.filePath);
      } catch (e) {
        console.error("Failed to delete reminder voice file:", e.message);
      }
    }

    reminders.splice(index, 1);
    writeJsonFile(REMINDERS_FILE, reminders);

    res.json({ success: true, message: "Reminder deleted successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/dashboard/speak
exports.postSpeak = async (req, res) => {
  try {
    const { text, language } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, error: "Text is required." });
    }

    await selectAudioForSpeak(text, language || "hi");
    res.json({ success: true, message: "Text converted and queued for streaming." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/dashboard/clear
exports.postClear = (req, res) => {
  try {
    clearQueueAndStop();
    res.json({ success: true, message: "Audio queue cleared and playback stopped." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/dashboard/upload-audio
// Expects raw binary audio buffer in req.body
exports.postUploadAudio = async (req, res) => {
  try {
    const playInstantly = req.query.playInstantly === "true";
    const buffer = req.body;

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ success: false, error: "Empty audio buffer received." });
    }

    const uniqueName = `voice_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const audioDir = path.join(__dirname, "../assets/audio");
    const tempPath = path.join(audioDir, `${uniqueName}.webm`);
    const mp3Path = path.join(audioDir, `${uniqueName}.mp3`);

    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    // Save temporary raw audio file
    fs.writeFileSync(tempPath, buffer);

    // Convert using ffmpeg
    await new Promise((resolve, reject) => {
      exec(
        `ffmpeg -y -i "${tempPath}" -fflags +bitexact -flags:a +bitexact -map_metadata -1 -filter:a "volume=3.0" -codec:a libmp3lame -b:a 64k -ar 16000 -ac 1 "${mp3Path}"`,
        (err) => {
          // Clean up temp webm
          try {
            fs.unlinkSync(tempPath);
          } catch (e) {}

          if (err) {
            console.error("FFmpeg transcode error:", err);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });

    if (playInstantly) {
      queueAudio("voice", mp3Path);
      res.json({ success: true, message: "Voice message queued instantly.", filePath: mp3Path });
    } else {
      res.json({ success: true, message: "Voice message uploaded and converted successfully.", filePath: mp3Path });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
