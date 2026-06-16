const fs = require("fs");
const path = require("path");

const logFile = path.join(__dirname, "../crash.log");

function logError(error, context = "Global") {
  const time = new Date().toISOString();
  const errMsg = error instanceof Error ? error.stack : String(error);
  const logMessage = `[${time}] [${context}] ERROR: ${errMsg}\n`;
  
  try {
    fs.appendFileSync(logFile, logMessage, "utf8");
  } catch (e) {
    process.stderr.write(`Failed to write to crash.log: ${e.message}\n`);
  }
  
  process.stderr.write(logMessage);
}

module.exports = { logError };
