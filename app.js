const { startEmailWatcher } = require("./mail_reads/read_mail");
async function main() {
  await startEmailWatcher();
}
main();
