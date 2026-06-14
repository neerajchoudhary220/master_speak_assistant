const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const venvPython = path.join(__dirname, "..", "tts", ".venv", "bin", "python");
const Audio_OUT_PUT = path.join(__dirname, "..", "assets", "audio");

if (!fs.existsSync(Audio_OUT_PUT)) {
  fs.mkdirSync(Audio_OUT_PUT, { recursive: true });
}

function generateHiAudio(text, fileName) {
  return new Promise((resolve, reject) => {
    const outputFilePath = path.join(Audio_OUT_PUT, `${fileName}.wav`);
    const scriptPath = path.join(__dirname, "..", "tts", "tts_hi.py");
    const processs = spawn(venvPython, [scriptPath, text, outputFilePath]);
    processs.stdout.on("data", (data) => console.log(`stdout: ${data}`));
    processs.stderr.on("data", (data) => console.error(`stderr: ${data}`));
    processs.on("close", (code) => {
      console.log(`child process exited with code ${code}`);
      if (code === 0) {
        // Boost volume to maximum (3x gain) and strip all metadata/encoder tags
        const tempPath = outputFilePath + ".tmp.wav";
        fs.rename(outputFilePath, tempPath, (renameErr) => {
          if (renameErr) return reject(renameErr);
          exec(`ffmpeg -y -i "${tempPath}" -fflags +bitexact -flags:a +bitexact -map_metadata -1 -filter:a "volume=3.0" -acodec pcm_s16le "${outputFilePath}"`, (ffmpegErr) => {
            try { fs.unlinkSync(tempPath); } catch (e) {}
            if (ffmpegErr) {
              reject(ffmpegErr);
            } else {
              resolve(outputFilePath);
            }
          });
        });
      } else {
        reject(new Error(`Hi-TTS script exited with code ${code}`));
      }
    });
    processs.on("error", (err) => {
      reject(err);
    });
  });
}

function generateEnAudio(text, fileName) {
  return new Promise((resolve, reject) => {
    const outputFilePath = path.join(Audio_OUT_PUT, `${fileName}.wav`);
    const scriptPath = path.join(__dirname, "..", "tts", "tts_en.py");
    const processs = spawn(venvPython, [scriptPath, text, outputFilePath]);
    processs.stdout.on("data", (data) => console.log(`stdout: ${data}`));
    processs.stderr.on("data", (data) => console.error(`stderr: ${data}`));
    processs.on("close", (code) => {
      console.log(`child process exited with code ${code}`);
      if (code === 0) {
        // Boost volume to maximum (3x gain) and strip all metadata/encoder tags
        const tempPath = outputFilePath + ".tmp.wav";
        fs.rename(outputFilePath, tempPath, (renameErr) => {
          if (renameErr) return reject(renameErr);
          exec(`ffmpeg -y -i "${tempPath}" -fflags +bitexact -flags:a +bitexact -map_metadata -1 -filter:a "volume=3.0" -acodec pcm_s16le "${outputFilePath}"`, (ffmpegErr) => {
            try { fs.unlinkSync(tempPath); } catch (e) {}
            if (ffmpegErr) {
              reject(ffmpegErr);
            } else {
              resolve(outputFilePath);
            }
          });
        });
      } else {
        reject(new Error(`En-TTS script exited with code ${code}`));
      }
    });
    processs.on("error", (err) => {
      reject(err);
    });
  });
}

module.exports = { generateHiAudio, generateEnAudio };
