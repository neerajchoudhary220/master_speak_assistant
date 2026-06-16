const fs = require("fs");
const path = require("path");

// Track active streaming response to allow immediate cancellation/stopping of audio
let activeResponse = null;

const sendThrottledFile = (filePath, res, req, extraHeaders = {}, onComplete = null) => {
  try {
    const stat = fs.statSync(filePath);
    const headers = {
      "Content-Type": "audio/mpeg",
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
      ...extraHeaders
    };
    res.writeHead(200, headers);

    const fileBuffer = fs.readFileSync(filePath);
    const totalLength = fileBuffer.length;

    // Send the first 12KB (or the entire file if smaller) immediately
    const initialBurstSize = Math.min(12288, totalLength);
    res.write(fileBuffer.slice(0, initialBurstSize));

    if (initialBurstSize >= totalLength) {
      // Keep connection open for 4 seconds after sending all data
      const timeoutId = setTimeout(() => {
        res.end();
        if (onComplete) onComplete();
      }, 4000);
      req.on("close", () => {
        clearTimeout(timeoutId);
      });
      return;
    }

    let offset = initialBurstSize;
    const chunkSize = 4096;
    const intervalId = setInterval(() => {
      if (offset < totalLength) {
        const nextChunkSize = Math.min(chunkSize, totalLength - offset);
        res.write(fileBuffer.slice(offset, offset + nextChunkSize));
        offset += nextChunkSize;
      } else {
        clearInterval(intervalId);
        // Keep connection open for 4 seconds after sending all data
        const timeoutId = setTimeout(() => {
          res.end();
          if (onComplete) onComplete();
        }, 4000);
        req.on("close", () => {
          clearTimeout(timeoutId);
        });
      }
    }, 400);

    req.on("close", () => {
      clearInterval(intervalId);
    });
  } catch (err) {
    console.error("Throttled file streaming error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: "error streaming audio file" });
    }
  }
};

// In-memory cache to handle browser Range/multiple requests for the same audio
let lastServed = null;
const CACHE_DURATION_MS = 3000; // 3 seconds cache duration

exports.getAudioStream = (req, res) => {
  const queuePath = path.join(__dirname, "..", "assets", "json", "audioQueue.json");

  try {
    // 1. Check if we recently served an audio file (to handle Range / duplicate requests)
    const reqId = req.query.id;
    let useCache = false;

    if (lastServed && (Date.now() - lastServed.timestamp < CACHE_DURATION_MS)) {
      if (reqId) {
        // If an ID is requested, only serve cache if it matches
        useCache = (lastServed.id === reqId);
      } else {
        // Otherwise, default to time-based caching
        useCache = true;
      }
    }

    if (useCache) {
      const cachedFilePath = lastServed.filePath;
      if (fs.existsSync(cachedFilePath)) {
        res.setHeader("X-Audio-Category", lastServed.category);
        res.setHeader("X-Audio-Priority", lastServed.priority.toString());
        res.setHeader("X-Audio-Cached", "true");

        res.sendFile(cachedFilePath, (err) => {
          if (err && !res.headersSent) {
            console.error(`Error sending cached audio file ${cachedFilePath}:`, err);
          }
        });
        return;
      }
    }

    if (!fs.existsSync(queuePath)) {
      return res.status(200).json({
        message: "audio stream",
        audio_available: false,
        audio_availabe: false,
      });
    }

    let data;
    try {
      data = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    } catch (e) {
      console.error("Error reading audioQueue.json", e);
      return res.status(500).json({ message: "internal server error reading queue" });
    }

    if (!data.queue || data.queue.length === 0) {
      return res.status(200).json({
        message: "audio stream",
        audio_available: false,
        audio_availabe: false,
      });
    }

    // Process the queue to find the first valid audio file
    while (data.queue.length > 0) {
      const audioItem = data.queue[0];
      const filePath = audioItem.filePath;

      if (fs.existsSync(filePath)) {
        // Remove item from queue list immediately to prevent double-streaming
        data.queue.shift();
        fs.writeFileSync(queuePath, JSON.stringify(data, null, 2), "utf8");

        // Set cache for browser Range requests
        lastServed = {
          id: audioItem.id,
          filePath,
          timestamp: Date.now(),
          category: audioItem.category,
          priority: audioItem.priority
        };

        // If there's another item in the queue, notify WebSocket clients of it
        if (data.queue.length > 0 && global.broadcastAudioAvailable) {
          const nextItem = data.queue[0];
          // We can broadcast with a small delay so the client has started downloading the current one
          setTimeout(() => {
            if (global.broadcastAudioAvailable) {
              global.broadcastAudioAvailable(nextItem);
            }
          }, 1500);
        }

        // Track active streaming response
        activeResponse = res;

        // Send the file with throttling to prevent ESP32 from closing connection early
        sendThrottledFile(
          filePath,
          res,
          req,
          {
            "X-Audio-Category": audioItem.category,
            "X-Audio-Priority": audioItem.priority.toString()
          },
          () => {
            if (activeResponse === res) {
              activeResponse = null;
            }
          }
        );

        // Delete file after 30 seconds to allow complete transmission/buffering
        setTimeout(() => {
          if (fs.existsSync(filePath)) {
            fs.unlink(filePath, (unlinkErr) => {
              if (unlinkErr) console.error(`Failed to delete processed audio file ${filePath}:`, unlinkErr);
              else console.log(`Deleted processed audio file after delay: ${filePath}`);
            });
          }
        }, 30000); // 30 seconds delay

        return; // Stream started, response is handled
      } else {
        // File doesn't exist, remove from queue and proceed to next
        console.warn(`File in queue not found: ${filePath}. Removing from queue.`);
        data.queue.shift();
      }
    }

    // If we finished the loop and found no valid files, save the cleaned up queue
    fs.writeFileSync(queuePath, JSON.stringify(data, null, 2), "utf8");
    return res.status(200).json({
      message: "audio stream",
      audio_available: false,
      audio_availabe: false,
    });

  } catch (error) {
    console.error("Error in getAudioStream:", error);
    res.status(500).json({ message: "internal server error" });
  }
};

exports.resetQueue = (req, res) => {
  try {
    clearQueueAndStop();
    return res.status(200).json({ success: true, message: "Queue reset successfully" });
  } catch (error) {
    console.error("Error resetting queue:", error);
    res.status(500).json({ message: "internal server error" });
  }
};

const clearQueueAndStop = () => {
  const queuePath = path.join(__dirname, "..", "assets", "json", "audioQueue.json");

  // Abort active streaming response immediately
  if (activeResponse) {
    console.log("[Stream] Aborting active streaming response.");
    try {
      activeResponse.destroy();
    } catch (err) {
      console.error("Failed to destroy active response:", err.message);
    }
    activeResponse = null;
  }

  try {
    if (!fs.existsSync(queuePath)) {
      return;
    }

    let data;
    try {
      data = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    } catch (e) {
      console.error("Error reading audioQueue.json", e);
      return;
    }

    if (data.queue && data.queue.length > 0) {
      // Delete files from disk
      data.queue.forEach((item) => {
        if (fs.existsSync(item.filePath)) {
          try {
            fs.unlinkSync(item.filePath);
            console.log(`Deleted file on queue reset: ${item.filePath}`);
          } catch (err) {
            console.error(`Failed to delete file ${item.filePath} on reset:`, err.message);
          }
        }
      });
    }

    // Reset queue array
    data.queue = [];
    fs.writeFileSync(queuePath, JSON.stringify(data, null, 2), "utf8");

    // Clear in-memory cache
    lastServed = null;

    // Notify all WebSocket clients that the queue has been reset and audio should stop
    if (global.wsClients && global.wsClients.size > 0) {
      const msg = JSON.stringify({ event: "queue_reset" });
      console.log(`[WS] Broadcasting queue_reset to ${global.wsClients.size} clients.`);
      for (const client of global.wsClients) {
        if (client.readyState === 1) { // WebSocket.OPEN is 1
          client.send(msg);
        }
      }
    }
  } catch (error) {
    console.error("Error in clearQueueAndStop:", error);
  }
};

exports.clearQueueAndStop = clearQueueAndStop;

exports.getConnectAudio = (req, res) => {
  const filePath = path.join(__dirname, "..", "assets", "audio", "connect.mp3");
  if (fs.existsSync(filePath)) {
    sendThrottledFile(filePath, res, req);
  } else {
    res.status(404).json({ message: "connect.mp3 not found" });
  }
};

exports.getTestAudio = (req, res) => {
  const filePath = path.join(__dirname, "..", "assets", "audio", "test.mp3");
  if (fs.existsSync(filePath)) {
    sendThrottledFile(filePath, res, req);
  } else {
    res.status(404).json({ message: "test.mp3 not found" });
  }
};

exports.triggerTestAudio = (req, res) => {
  try {
    const filePath = path.join(__dirname, "..", "assets", "audio", "test.mp3");
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "test.mp3 file not found on server" });
    }
    
    // Import queueAudio from generate_audio_files/audio.js
    const { queueAudio } = require("../generate_audio_files/audio");
    
    // Queue the audio for "speak" category (highest priority)
    queueAudio("speak", filePath);
    
    return res.status(200).json({
      success: true,
      message: "Test audio queued and WebSocket broadcast sent successfully."
    });
  } catch (error) {
    console.error("Error triggering test audio:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};


