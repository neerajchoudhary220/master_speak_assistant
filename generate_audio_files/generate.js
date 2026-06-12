const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const venvPython = path.join(__dirname, "..", "tts", ".venv", "bin", "python");
const Audio_OUT_PUT = path.join(__dirname, "..", "assets", "audio");

if (!fs.existsSync(Audio_OUT_PUT)) {
  fs.mkdirSync(Audio_OUT_PUT, { recursive: true });
}
async function generateHiAudio(text, fileName) {
  const outputFilePath = path.join(Audio_OUT_PUT, `${fileName}.wav`);
  const scriptPath = path.join(__dirname, "..", "tts", "tts_hi.py");
  const processs = spawn(venvPython, [scriptPath, text, outputFilePath]);
  processs.stdout.on("data", (data) => console.log(`stdout: ${data}`));
  processs.stderr.on("data", (data) => console.error(`stderr: ${data}`));
  processs.on("close", (code) =>
    console.log(`child process exited with code ${code}`),
  );
}

async function generateEnAudio(text, fileName) {
  const outputFilePath = path.join(Audio_OUT_PUT, `${fileName}.wav`);
  const scriptPath = path.join(__dirname, "..", "tts", "tts_en.py");
  const processs = spawn(venvPython, [scriptPath, text, outputFilePath]);
  processs.stdout.on("data", (data) => console.log(`stdout: ${data}`));
  processs.stderr.on("data", (data) => console.error(`stderr: ${data}`));
  processs.on("close", (code) =>
    console.log(`child process exited with code ${code}`),
  );
}

module.exports = { generateHiAudio, generateEnAudio };
