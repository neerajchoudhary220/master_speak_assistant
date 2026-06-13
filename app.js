const { startEmailWatcher } = require("./mail_reads/read_mail");
async function main() {
  await startEmailWatcher();
  // Start the Telegram bot and crypto price monitoring engine
  require("./bots/bot");
}
main();
