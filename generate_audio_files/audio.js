const { generateEnAudio, generateHiAudio } = require("./generate");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const axios = require("axios");

const commandMsgPath = path.join(
  __dirname,
  "..",
  "assets",
  "json",
  "commandMsg.json",
);
const commandMsg = JSON.parse(fs.readFileSync(commandMsgPath, "utf8"));

function getCommandMsg(pathStr, variables = {}) {
  let template = pathStr
    .split(".")
    .reduce((obj, key) => obj?.[key], commandMsg);

  if (Array.isArray(template) && template.length > 0 && template[0].msg) {
    template = template[0].msg;
  } else if (template && typeof template === "object" && template.msg) {
    template = template.msg;
  }

  if (typeof template !== "string") {
    return "";
  }

  return template.replace(/\{\$(\w+)\}/g, (_, key) => variables[key] || "");
}

const queueAudio = (category, filePath) => {
  const queuePath = path.join(__dirname, "..", "assets", "json", "audioQueue.json");
  const jsonDir = path.dirname(queuePath);
  if (!fs.existsSync(jsonDir)) {
    fs.mkdirSync(jsonDir, { recursive: true });
  }

  let data = { priorities: { voice: 0, speak: 0, crypto: 1, mail: 2, reminder: 3 }, queue: [] };
  if (fs.existsSync(queuePath)) {
    try {
      data = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    } catch (e) {
      console.error("Error reading audioQueue.json, resetting", e);
    }
  }
  
  if (!data.priorities) {
    data.priorities = { voice: 0, speak: 0, crypto: 1, mail: 2, reminder: 3 };
  }
  if (!data.queue) {
    data.queue = [];
  }
  
  const priority = data.priorities[category] !== undefined ? data.priorities[category] : 10;
  
  const newItem = {
    id: Date.now().toString() + "_" + Math.random().toString(36).substr(2, 5),
    category,
    filePath,
    priority,
    createdAt: new Date().toISOString()
  };
  data.queue.push(newItem);
  
  // Sort queue: priority ascending, then createdAt ascending
  data.queue.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
  
  fs.writeFileSync(queuePath, JSON.stringify(data, null, 2), "utf8");
  console.log(`[Queue] Audio added for category '${category}' with priority ${priority}: ${filePath}`);

  // Broadcast via WebSocket
  if (global.broadcastAudioAvailable) {
    global.broadcastAudioAvailable(newItem);
  }
};

const selectAudio = async (category, data = {}, language = "en") => {
  const uniqueName = `${category}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  let filePath = "";
  switch (category) {
    case "mail": {
      const msg = getCommandMsg(`mails.${language}`, data);
      if (language === "en") {
        filePath = await generateEnAudio(msg, uniqueName);
      } else {
        filePath = await generateHiAudio(msg, uniqueName);
      }
      break;
    }
    case "crypto": {
      const msg = getCommandMsg(`crypto.${language}`, data);
      if (language === "en") {
        filePath = await generateEnAudio(msg, uniqueName);
      } else {
        filePath = await generateHiAudio(msg, uniqueName);
      }
      break;
    }
    default:
      break;
  }
  if (filePath) {
    queueAudio(category, filePath);
  }
};

const selectAudioForReminder = async (msg, language) => {
  const uniqueName = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  let filePath = "";
  switch (language) {
    case "en":
      filePath = await generateEnAudio(msg, uniqueName);
      break;
    case "hi":
      filePath = await generateHiAudio(msg, uniqueName);
      break;
    default:
      break;
  }
  if (filePath) {
    queueAudio("reminder", filePath);
  }
};

const selectAudioForSpeak = async (msg, language = "hi") => {
  const uniqueName = `speak_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  let filePath = "";
  if (language === "en") {
    filePath = await generateEnAudio(msg, uniqueName);
  } else {
    filePath = await generateHiAudio(msg, uniqueName);
  }
  if (filePath) {
    queueAudio("speak", filePath);
  }
};

const saveVoiceMessage = async (fileUrl, prefix = "voice") => {
  const uniqueName = `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const audioDir = path.join(__dirname, "..", "assets", "audio");
  const oggPath = path.join(audioDir, `${uniqueName}.ogg`);
  const wavPath = path.join(audioDir, `${uniqueName}.wav`);

  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }

  // Download the file
  const response = await axios({
    method: "GET",
    url: fileUrl,
    responseType: "stream"
  });

  const writer = fs.createWriteStream(oggPath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  // Convert to wav using ffmpeg with 3x volume boost and strip all metadata
  await new Promise((resolve, reject) => {
    exec(`ffmpeg -y -i "${oggPath}" -fflags +bitexact -flags:a +bitexact -map_metadata -1 -filter:a "volume=3.0" -acodec pcm_s16le -ar 16000 -ac 1 "${wavPath}"`, (err, stdout, stderr) => {
      // Clean up the ogg file
      try {
        fs.unlinkSync(oggPath);
      } catch (e) {}

      if (err) {
        console.error("FFmpeg error converting ogg to wav:", err);
        reject(err);
      } else {
        resolve();
      }
    });
  });

  return wavPath;
};

const queueVoiceAudio = async (fileUrl) => {
  try {
    const wavPath = await saveVoiceMessage(fileUrl, "voice");
    queueAudio("voice", wavPath);
  } catch (err) {
    console.error("Error queueing voice audio:", err);
    throw err;
  }
};

module.exports = { selectAudio, selectAudioForReminder, selectAudioForSpeak, queueVoiceAudio, saveVoiceMessage, queueAudio };
