const { generateEnAudio, generateHiAudio } = require("./generate");
const fs = require("fs");
const path = require("path");

const commandMsgPath = path.join(__dirname, "..", "assets", "json", "commandMsg.json");
const commandMsg = JSON.parse(fs.readFileSync(commandMsgPath, "utf8"));

function getCommandMsg(pathStr, variables = {}) {
  let template = pathStr.split(".").reduce((obj, key) => obj?.[key], commandMsg);

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

const selectAudio = async (category, data = {}, language = "en") => {
  switch (category) {
    case "mail": {
      const msg = getCommandMsg(`mails.${language}`, data);
      if (language === "en") {
        await generateEnAudio(msg, "mail");
      } else {
        await generateHiAudio(msg, "mail");
      }
      break;
    }
    case "crypto": {
      const msg = getCommandMsg(`crypto.${language}`, data);
      if (language === "en") {
        await generateEnAudio(msg, "crypto");
      } else {
        await generateHiAudio(msg, "crypto");
      }
      break;
    }
    default:
      break;
  }
};

module.exports = { selectAudio };
