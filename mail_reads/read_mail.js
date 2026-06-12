const { authorize, getLatestUnreadMail } = require("./gmail_operation");
const { selectAudio } = require("../generate_audio_files/audio");
const { ImapFlow } = require("imapflow");
const { google } = require("googleapis");

async function readUnreadMail() {
  const auth = await authorize();
  const unreadMail = await getLatestUnreadMail(auth);
  if (!unreadMail) {
    return;
  }
  const { sender, date } = unreadMail;
  selectAudio("mail", { sender, date }, "hi");
}

async function startEmailWatcher() {
  const auth = await authorize();

  // 1. Run a manual check on startup to capture any emails received offline
  console.log("Checking for unread messages on startup...");
  await readUnreadMail();

  // 2. Fetch authenticated user's email address
  const gmail = google.gmail({ version: "v1", auth });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress;
  console.log(`Authenticated as: ${email}`);

  // 3. Get the access token
  const tokenInfo = await auth.getAccessToken();
  const accessToken = tokenInfo.token;

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    logger: false,
    auth: {
      user: email,
      accessToken: accessToken,
    },
  });

  client.on("exists", async (data) => {
    console.log("New mail activity detected in inbox. Checking...");
    try {
      await readUnreadMail();
    } catch (err) {
      console.error("Error processing new mail:", err);
    }
  });

  client.on("error", (err) => {
    console.error("IMAP Client Error:", err);
  });

  client.on("close", () => {
    console.log("IMAP connection closed. Reconnecting in 5 seconds...");
    setTimeout(() => {
      startEmailWatcher().catch(console.error);
    }, 5000);
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    console.log("IMAP connection established. Listening for new emails in real-time...");

    process.on("SIGINT", async () => {
      console.log("Disconnecting watcher...");
      lock.release();
      await client.logout();
      process.exit(0);
    });
  } catch (err) {
    console.error("Failed to establish IMAP connection. Retrying in 5 seconds...", err);
    setTimeout(() => {
      startEmailWatcher().catch(console.error);
    }, 5000);
  }
}

module.exports = { readUnreadMail, startEmailWatcher };
