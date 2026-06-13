const express = require("express");
const app = express();
const streamRouter = require("./routes/streamRoute");
const http = require("http");
const WebSocket = require("ws");
const os = require("os");
const fs = require("fs");
const path = require("path");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

app.use("/api", streamRouter);

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store active WebSocket connections
global.wsClients = new Set();

// Helper to get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === "IPv4" && alias.address !== "127.0.0.1" && !alias.internal) {
        return alias.address;
      }
    }
  }
  return "localhost";
}

// Function to broadcast event to all connected ws clients
function broadcastAudioAvailable(details) {
  if (!global.wsClients || global.wsClients.size === 0) return;
  const msg = JSON.stringify({
    event: "audio_available",
    url: `http://${getLocalIP()}:3000/api/audio-stream?id=${details.id}`,
    category: details.category,
    priority: details.priority,
    id: details.id
  });
  console.log(`[WS] Broadcasting audio_available to ${global.wsClients.size} clients: ${details.category}`);
  for (const client of global.wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// Share broadcast helper globally so other modules can access it
global.broadcastAudioAvailable = broadcastAudioAvailable;

// Helper to check and notify a client of pending audio upon connection
function checkAndNotifyPendingAudio(ws) {
  const queuePath = path.join(__dirname, "assets", "json", "audioQueue.json");
  if (!fs.existsSync(queuePath)) return;

  try {
    const data = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    if (data.queue && data.queue.length > 0) {
      const audioItem = data.queue[0];
      const msg = JSON.stringify({
        event: "audio_available",
        url: `http://${getLocalIP()}:3000/api/audio-stream?id=${audioItem.id}`,
        category: audioItem.category,
        priority: audioItem.priority,
        id: audioItem.id
      });
      console.log(`[WS] Notifying newly connected client of pending audio: ${audioItem.category}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  } catch (e) {
    console.error("[WS] Error checking queue for pending audio:", e.message);
  }
}

wss.on("connection", (ws) => {
  console.log("[WS] Client connected");
  global.wsClients.add(ws);

  // Send pending audio immediately if any exists in queue
  checkAndNotifyPendingAudio(ws);

  ws.on("close", () => {
    console.log("[WS] Client disconnected");
    global.wsClients.delete(ws);
  });

  ws.on("error", (err) => {
    console.error("[WS] Connection error:", err.message);
    global.wsClients.delete(ws);
  });
});

server.listen(3000, () => {
  console.log("Server started on port 3000");
});

const { startEmailWatcher } = require("./mail_reads/read_mail");

function cleanupOrphanedAudioFiles() {
  console.log("[Cleanup] Starting orphaned audio files cleanup...");
  const audioDir = path.join(__dirname, "assets", "audio");
  const queuePath = path.join(__dirname, "assets", "json", "audioQueue.json");
  const remindersPath = path.join(__dirname, "assets", "json", "reminders.json");

  if (!fs.existsSync(audioDir)) return;

  // 1. Collect active files from queue
  const activeFiles = new Set();
  if (fs.existsSync(queuePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(queuePath, "utf8"));
      if (data.queue) {
        data.queue.forEach(item => {
          if (item.filePath) activeFiles.add(path.resolve(item.filePath));
        });
      }
    } catch (e) {
      console.error("[Cleanup] Error reading queue file:", e.message);
    }
  }

  // 2. Collect active files from reminders
  if (fs.existsSync(remindersPath)) {
    try {
      const reminders = JSON.parse(fs.readFileSync(remindersPath, "utf8"));
      reminders.forEach(item => {
        if (item.filePath) activeFiles.add(path.resolve(item.filePath));
      });
    } catch (e) {
      console.error("[Cleanup] Error reading reminders file:", e.message);
    }
  }

  // 3. Scan directory and delete orphaned generated files
  try {
    const files = fs.readdirSync(audioDir);
    files.forEach(file => {
      const isGenerated = file.startsWith("mail_") || 
                          file.startsWith("reminder_") || 
                          file.startsWith("speak_") || 
                          file.startsWith("voice_") || 
                          file.startsWith("crypto_");
                          
      if (isGenerated) {
        const fullPath = path.resolve(path.join(audioDir, file));
        if (!activeFiles.has(fullPath)) {
          try {
            fs.unlinkSync(fullPath);
            console.log(`[Cleanup] Deleted orphaned audio file: ${file}`);
          } catch (err) {
            console.error(`[Cleanup] Failed to delete ${file}:`, err.message);
          }
        }
      }
    });
  } catch (err) {
    console.error("[Cleanup] Error scanning audio directory:", err.message);
  }
}

async function main() {
  cleanupOrphanedAudioFiles();
  await startEmailWatcher();
  // Start the Telegram bot and crypto price monitoring engine
  require("./bots/bot");
}
main().catch(console.error);
