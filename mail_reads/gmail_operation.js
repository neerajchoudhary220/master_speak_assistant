const fs = require("fs");
const { google } = require("googleapis");
const path = require("path");
const TOKEN_PATH = path.join(process.cwd(), "assets/json/token.json");
const CREDENTIALS_PATH = path.join(
  process.cwd(),
  "assets/json/credentials.json",
);

async function authorize() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0],
  );

  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oAuth2Client.setCredentials(token);

  return oAuth2Client;
}

function getExtractedData(msgData) {
  const headers = msgData.payload.headers;

  const from = headers.find((h) => h.name === "From")?.value || "";

  const subject = headers.find((h) => h.name === "Subject")?.value || "";

  const dateRaw = headers.find((h) => h.name === "Date")?.value || "";
  let date = dateRaw;
  if (dateRaw) {
    const parsed = new Date(dateRaw);
    if (!isNaN(parsed.getTime())) {
      const day = parsed.getDate();
      const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const month = months[parsed.getMonth()];
      const year = parsed.getFullYear();
      date = `${day} ${month} ${year}`;
    }
  }

  const sender = from.match(/^(.*?)\s*</)?.[1] || from;

  let category = "Unknown";

  const labels = msgData.labelIds || [];

  if (labels.includes("CATEGORY_PERSONAL")) category = "Primary";
  else if (labels.includes("CATEGORY_UPDATES")) category = "Updates";
  else if (labels.includes("CATEGORY_PROMOTIONS")) category = "Promotions";
  else if (labels.includes("CATEGORY_SOCIAL")) category = "Social";
  else if (labels.includes("CATEGORY_FORUMS")) category = "Forums";

  return {
    id: msgData.id,
    sender,
    from,
    subject,
    category,
    date,
  };
}

async function getLatestUnreadMail(auth) {
  const gmail = google.gmail({ version: "v1", auth });

  const res = await gmail.users.messages.list({
    userId: "me",
    maxResults: 1,
    q: "is:unread",
  });

  if (!res.data.messages || res.data.messages.length === 0) {
    console.log("No unread messages found");
    return;
  }

  const messageId = res.data.messages[0].id;
  console.log("Message ID:", messageId);

  const msg = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
  });
  const extractedData = getExtractedData(msg.data);

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: ["UNREAD"],
    },
  });
  console.log("Message marked as read");

  return extractedData;
}

module.exports = { authorize, getLatestUnreadMail };
