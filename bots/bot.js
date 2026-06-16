const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const TelegramBot = require("node-telegram-bot-api");
const { logError } = require("../utils/logger");
const fs = require("fs");
const {
  selectAudio,
  selectAudioForReminder,
  selectAudioForSpeak,
  queueVoiceAudio,
  saveVoiceMessage,
  queueAudio,
} = require("../generate_audio_files/audio");
const {
  getMexcSymbolDetails,
  formatMexcDetails,
  verifySymbolAndGetPrice,
  getPricesForSymbols,
  getDefaultMarketDashboard,
} = require("./crypto");
const { clearQueueAndStop } = require("../controllers/streamcontroller");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const token = process.env.TELEGRAM_BOT_TOKEN;
const TRIGGERS_FILE = path.join(__dirname, "../assets/json/triggers.json");

if (!token) {
  console.error("Error: TELEGRAM_BOT_TOKEN is not defined in .env file.");
  process.exit(1);
}

// Silence all console logs and errors to prevent PM2 log bloating
console.log = () => {};
console.error = () => {};

// Bot initialize with polling enabled so it can receive messages
const bot = new TelegramBot(token, { polling: true });

bot.on("polling_error", (error) => {
  logError(error, "Telegram polling_error");
});

bot.on("error", (error) => {
  logError(error, "Telegram general_error");
});

// User conversation states
const userStates = {};

// ─── REPLY KEYBOARD (Persistent bottom buttons) ──────────────────────────────
const mainKeyboard = {
  keyboard: [
    [{ text: "➕ Add Alert" }, { text: "📋 List Alerts" }],
    [{ text: "💰 Check Price" }, { text: "⭐️ Fav Coins" }],
    [{ text: "⏰ Set Reminder" }, { text: "🎙️ Voice Reminder" }],
    [{ text: "📋 List Reminders" }, { text: "🗣️ Speak Message" }],
    [{ text: "🧹 Clear Queue" }, { text: "❓ Help" }],
  ],
  resize_keyboard: true,
};

// ─── DATABASE FUNCTIONS ───────────────────────────────────────────────────────

const FAVORITES_FILE = path.join(__dirname, "../assets/json/favorites.json");
const REMINDERS_FILE = path.join(__dirname, "../assets/json/reminders.json");

function readReminders() {
  try {
    if (!fs.existsSync(REMINDERS_FILE)) {
      fs.writeFileSync(REMINDERS_FILE, JSON.stringify([], null, 2));
      return [];
    }
    const data = fs.readFileSync(REMINDERS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading reminders file:", error.message);
    return [];
  }
}

function writeReminders(reminders) {
  try {
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
  } catch (error) {
    console.error("Error writing reminders file:", error.message);
  }
}

function clearAudioQueue() {
  clearQueueAndStop();
}

function readFavorites() {
  try {
    if (!fs.existsSync(FAVORITES_FILE)) {
      fs.writeFileSync(FAVORITES_FILE, JSON.stringify({}, null, 2));
      return {};
    }
    const data = fs.readFileSync(FAVORITES_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading favorites file:", error.message);
    return {};
  }
}

function writeFavorites(favorites) {
  try {
    fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favorites, null, 2));
  } catch (error) {
    console.error("Error writing favorites file:", error.message);
  }
}

function getUserFavorites(chatId) {
  const favorites = readFavorites();
  return favorites[chatId] || [];
}

function addUserFavorite(chatId, symbol) {
  const favorites = readFavorites();
  if (!favorites[chatId]) {
    favorites[chatId] = [];
  }
  const cleanSymbol = symbol.toUpperCase().trim();
  if (!favorites[chatId].includes(cleanSymbol)) {
    favorites[chatId].push(cleanSymbol);
    writeFavorites(favorites);
    return true;
  }
  return false;
}

function removeUserFavorite(chatId, symbol) {
  const favorites = readFavorites();
  if (favorites[chatId]) {
    const cleanSymbol = symbol.toUpperCase().trim();
    const index = favorites[chatId].indexOf(cleanSymbol);
    if (index !== -1) {
      favorites[chatId].splice(index, 1);
      writeFavorites(favorites);
      return true;
    }
  }
  return false;
}

function readTriggers() {
  try {
    if (!fs.existsSync(TRIGGERS_FILE)) {
      fs.writeFileSync(TRIGGERS_FILE, JSON.stringify([], null, 2));
      return [];
    }
    const data = fs.readFileSync(TRIGGERS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading triggers file:", error.message);
    return [];
  }
}

function writeTriggers(triggers) {
  try {
    fs.writeFileSync(TRIGGERS_FILE, JSON.stringify(triggers, null, 2));
  } catch (error) {
    console.error("Error writing triggers file:", error.message);
  }
}

// Helper to wait for ms
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

function getHelpMessage() {
  return `👋 *Welcome to your Personal Smart Assistant Bot!* 🤖✨
Aap yahan real-time system alerts, multi-functional reminders, aur direct audio/voice streaming controls manage kar sakte hain.

💡 *General Commands & Actions:*
🗣️ \`/speak\` or click *🗣️ Speak Message* - Type anything to convert to voice and stream instantly on your speakers!
🎙️ Send Voice Note - Kisi bhi voice message/audio record karke send karein, bot download karke direct play/stream kar dega!
⏰ \`/reminder\` or click *⏰ Set Reminder* - Text reminder schedule karein jo trigger hone par alert voice stream karega.
🎙️ \`/voicereminder\` or click *🎙️ Voice Reminder* - Apni custom voice record karke reminder lagayein! Trigger hone par direct aapki voice play hogi.
📋 \`/reminders\` or click *📋 List Reminders* - Apne active reminders manage/edit/delete karein.
🧹 \`/clearqueue\` / \`/resetqueue\` or click *🧹 Clear Queue* - Saari alerts queue delete karein aur active streaming ko instantly stop karein.

📈 *Crypto Alerts Commands:*
➕ \`/add <COIN> <PRICE> [above/below]\` - Target price trigger and voice stream set karein
   _Example:_ \`/add BTCUSDT 69000 above\`
📋 \`/list\` or click *📋 List Alerts* - Apne saare active crypto triggers manage karein
💰 \`/price <COIN>\` or click *💰 Check Price* - Live prices check karein
⭐️ click *⭐️ Fav Coins* - Apne favorite coins manage karein

*Quick Tips:*
Aap bottom reply keyboard buttons ka use karke visual wizards block-by-block complete kar sakte hain!`;
}

// ─── TELEGRAM MESSAGE HANDLERS ────────────────────────────────────────────────

// Handle /reminder
bot.onText(/\/reminder/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { action: "add_reminder_note" };
  return bot.sendMessage(
    chatId,
    "⏰ **Set Reminder (Step 1 of 2):**\n\nPlease enter the reminder note/message (e.g., *Meeting with team*, *Buy groceries*):",
    { parse_mode: "Markdown", reply_markup: mainKeyboard },
  );
});

// Handle /voicereminder
bot.onText(/\/voicereminder/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { action: "add_voice_reminder_file" };
  return bot.sendMessage(
    chatId,
    "🎙️ **Set Voice Reminder (Step 1 of 2):**\n\nPlease record and send your voice note/message now:",
    { parse_mode: "Markdown", reply_markup: mainKeyboard },
  );
});

// Handle /reminders
bot.onText(/\/reminders/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = null;
  await sendRemindersList(chatId);
}); // Handle /speak
bot.onText(/\/speak/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { action: "speak_text" };
  return bot.sendMessage(
    chatId,
    "🗣️ **Speak Message:**\n\nPlease type the text message you want me to convert to speech and stream immediately:",
    { parse_mode: "Markdown", reply_markup: mainKeyboard },
  );
});

// Handle /clearqueue and /resetqueue
bot.onText(/\/(clearqueue|resetqueue)/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = null;
  clearAudioQueue();
  return bot.sendMessage(
    chatId,
    "🧹 **Audio Stream Queue has been cleared successfully!**",
    {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard,
    },
  );
});

bot.onText(/\/start|\/help/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = null; // Reset state

  const dashboard = await getDefaultMarketDashboard();
  const opts = {
    parse_mode: "Markdown",
    reply_markup: mainKeyboard,
  };

  bot.sendMessage(chatId, `${getHelpMessage()}\n\n${dashboard}`, opts);
});

// Handle /price <symbol>
bot.onText(/\/price(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  userStates[chatId] = null; // Reset state

  let symbol = match[1];
  if (!symbol) {
    userStates[chatId] = { action: "check_price_symbol" };
    return bot.sendMessage(
      chatId,
      "🔍 Which coin price do you want to check? Enter symbol (e.g. BTC, ETH, SIRENUSDT):",
      { reply_markup: mainKeyboard },
    );
  }

  symbol = symbol.toUpperCase();
  let details = await getMexcSymbolDetails(symbol);
  if (details === null && !symbol.endsWith("USDT")) {
    const usdtSymbol = symbol + "USDT";
    const usdtDetails = await getMexcSymbolDetails(usdtSymbol);
    if (usdtDetails !== null) {
      symbol = usdtSymbol;
      details = usdtDetails;
    }
  }

  if (details === null) {
    return bot.sendMessage(
      chatId,
      `❌ Symbol *${symbol}* not found on MEXC Spot.`,
      { parse_mode: "Markdown", reply_markup: mainKeyboard },
    );
  }

  bot.sendMessage(chatId, formatMexcDetails(symbol, details), {
    parse_mode: "Markdown",
    reply_markup: mainKeyboard,
  });
});

// Handle /add <symbol> <price> [direction]
bot.onText(
  /\/add(?:\s+(\S+)\s+(\d+(?:\.\d+)?)(?:\s+(above|below|up|down|go_above|go_below))?)?/,
  async (msg, match) => {
    const chatId = msg.chat.id;
    userStates[chatId] = null; // Reset state

    let symbol = match[1];
    let priceStr = match[2];
    let dirInput = match[3];

    if (!symbol || !priceStr) {
      // Start step-by-step wizard
      userStates[chatId] = { action: "add_symbol" };
      const favs = getUserFavorites(chatId);
      if (favs.length > 0) {
        const keyboardRows = [];
        for (let i = 0; i < favs.length; i += 2) {
          const row = [
            { text: `⭐ ${favs[i]}`, callback_data: `favselect_${favs[i]}` },
          ];
          if (i + 1 < favs.length) {
            row.push({
              text: `⭐ ${favs[i + 1]}`,
              callback_data: `favselect_${favs[i + 1]}`,
            });
          }
          keyboardRows.push(row);
        }
        return bot.sendMessage(
          chatId,
          "➕ **Add Alert Wizard:**\nPlease choose a coin from your *Favorites* below, or type the symbol manually (e.g., BTC, ETH):",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: keyboardRows,
            },
          },
        );
      } else {
        return bot.sendMessage(
          chatId,
          "➕ **Add Alert Wizard:**\nEnter coin symbol (e.g. BTC, ETH, SIRENUSDT):",
          { reply_markup: mainKeyboard },
        );
      }
    }

    symbol = symbol.toUpperCase();
    const targetPrice = parseFloat(priceStr);

    bot.sendMessage(chatId, `⏳ Checking price for *${symbol}*...`, {
      parse_mode: "Markdown",
    });

    let currentPrice = await verifySymbolAndGetPrice(symbol);
    if (currentPrice === null && !symbol.endsWith("USDT")) {
      const usdtSymbol = symbol + "USDT";
      const usdtPrice = await verifySymbolAndGetPrice(usdtSymbol);
      if (usdtPrice !== null) {
        symbol = usdtSymbol;
        currentPrice = usdtPrice;
      }
    }

    if (currentPrice === null) {
      return bot.sendMessage(
        chatId,
        `❌ Symbol *${symbol}* not found on MEXC Spot. Please enter a valid symbol.`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    }

    // Check if direction is provided in command
    if (dirInput) {
      let direction = "above";
      if (["below", "down", "go_below"].includes(dirInput.toLowerCase())) {
        direction = "below";
      }

      const newTrigger = {
        id: Date.now().toString(),
        symbol,
        targetPrice,
        direction,
        chatId,
        createdAt: new Date().toISOString(),
      };

      const triggers = readTriggers();
      triggers.push(newTrigger);
      writeTriggers(triggers);

      const dirText = direction === "above" ? "above 📈" : "below 📉";
      return bot.sendMessage(
        chatId,
        `✅ **Alert Added Successfully!**\n\n` +
          `🪙 Symbol: *${symbol}*\n` +
          `💵 Current Price: *$${currentPrice}*\n` +
          `🎯 Target Price: *$${targetPrice}*\n` +
          `🔔 Trigger Condition: When price goes *${dirText}*\n` +
          `🆔 Alert ID: \`${newTrigger.id}\``,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    }

    // If direction is NOT provided in command, prompt for it manually using buttons
    userStates[chatId] = {
      action: "add_direction",
      symbol,
      targetPrice,
      currentPrice,
    };
    const inlineKeyboard = [
      [
        { text: "📈 Go Above", callback_data: "setdir_above" },
        { text: "📉 Go Below", callback_data: "setdir_below" },
      ],
    ];
    bot.sendMessage(
      chatId,
      `🎯 Target Price: *$${targetPrice}*\n` +
        `Current price of *${symbol}* is *$${currentPrice}*.\n\n` +
        `Choose when to trigger the alert:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      },
    );
  },
);

// Handle /list
bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = null; // Reset state
  await sendAlertsList(chatId);
});

// Helper function to format and send the alerts list
async function sendAlertsList(chatId, messageId = null) {
  const triggers = readTriggers().filter((t) => t.chatId === chatId);

  if (triggers.length === 0) {
    const text =
      "ℹ️ You don't have any active alerts. Use \`/add\` to set a new alert.";
    const opts = { parse_mode: "Markdown", reply_markup: mainKeyboard };
    if (messageId) {
      return bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...opts,
      });
    } else {
      return bot.sendMessage(chatId, text, opts);
    }
  }

  // Get active symbols to fetch live prices
  const symbols = [...new Set(triggers.map((t) => t.symbol))];
  const livePrices = await getPricesForSymbols(symbols);

  let responseText = "📋 *Your Active Price Alerts:*\n\n";
  const keyboard = [];

  triggers.forEach((trigger, idx) => {
    const livePrice = livePrices[trigger.symbol];
    const livePriceStr =
      livePrice !== undefined ? `$${livePrice}` : "Fetching failed";
    const dirIcon = trigger.direction === "above" ? "📈 Above" : "📉 Below";

    responseText +=
      `🔔 *${idx + 1}. ${trigger.symbol}*\n` +
      `   ├ Target: *$${trigger.targetPrice}* (When goes ${dirIcon})\n` +
      `   ├ Live Price: *${livePriceStr}*\n` +
      `   └ ID: \`${trigger.id}\`\n\n`;

    // Row of buttons for each trigger
    keyboard.push([
      { text: `✏️ Edit #${idx + 1}`, callback_data: `edit_${trigger.id}` },
      { text: `❌ Delete #${idx + 1}`, callback_data: `delete_${trigger.id}` },
    ]);
  });

  const opts = {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: keyboard,
    },
  };

  if (messageId) {
    try {
      await bot.editMessageText(responseText, {
        chat_id: chatId,
        message_id: messageId,
        ...opts,
      });
    } catch (e) {
      // If content is identical, editMessageText throws an error. Catch it silently.
      if (!e.message.includes("message is not modified")) {
        console.error("Edit message error:", e.message);
      }
    }
  } else {
    await bot.sendMessage(chatId, responseText, opts);
  }
}

// Helper function to format and send the reminders list
async function sendRemindersList(chatId, messageId = null) {
  const reminders = readReminders().filter((r) => r.chatId === chatId);

  if (reminders.length === 0) {
    const text =
      "ℹ️ You don't have any active reminders. Use `⏰ Set Reminder` to create one.";
    const opts = { parse_mode: "Markdown", reply_markup: mainKeyboard };
    if (messageId) {
      return bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...opts,
      });
    } else {
      return bot.sendMessage(chatId, text, opts);
    }
  }

  let responseText = "📋 *Your Scheduled Reminders:*\n\n";
  const keyboard = [];

  reminders.forEach((reminder, idx) => {
    const timeStr = new Date(reminder.time).toLocaleString("en-GB", {
      hour12: false,
    });
    responseText +=
      `⏰ *${idx + 1}.* Note: *${reminder.note}*\n` +
      `   ├ Time: \`${timeStr}\`\n` +
      `   └ ID: \`${reminder.id}\`\n\n`;

    keyboard.push([
      {
        text: `✏️ Note #${idx + 1}`,
        callback_data: `editrem_note_${reminder.id}`,
      },
      {
        text: `📅 Time #${idx + 1}`,
        callback_data: `editrem_time_${reminder.id}`,
      },
      {
        text: `❌ Delete #${idx + 1}`,
        callback_data: `deleterem_${reminder.id}`,
      },
    ]);
  });

  const opts = {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: keyboard,
    },
  };

  if (messageId) {
    try {
      await bot.editMessageText(responseText, {
        chat_id: chatId,
        message_id: messageId,
        ...opts,
      });
    } catch (e) {
      if (!e.message.includes("message is not modified")) {
        console.error("Edit message error:", e.message);
      }
    }
  } else {
    await bot.sendMessage(chatId, responseText, opts);
  }
}

// Handle /delete <id>
bot.onText(/\/delete(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  userStates[chatId] = null; // Reset state

  const alertId = match[1];
  if (!alertId) {
    return bot.sendMessage(
      chatId,
      "⚠️ Usage: \`/delete <ALERT_ID>\`\nExample: \`/delete 1686235492000\`",
      { parse_mode: "Markdown", reply_markup: mainKeyboard },
    );
  }

  const triggers = readTriggers();
  const index = triggers.findIndex(
    (t) => t.id === alertId && t.chatId === chatId,
  );

  if (index === -1) {
    return bot.sendMessage(chatId, `❌ Alert ID \`${alertId}\` not found.`, {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard,
    });
  }

  const deletedSymbol = triggers[index].symbol;
  const deletedPrice = triggers[index].targetPrice;
  triggers.splice(index, 1);
  writeTriggers(triggers);

  const currentPrice = await verifySymbolAndGetPrice(deletedSymbol);
  const priceMsg =
    currentPrice !== null ? ` (Current Price: *$${currentPrice}*)` : "";

  bot.sendMessage(
    chatId,
    `🗑️ Alert for *${deletedSymbol}* at *$${deletedPrice}* has been deleted successfully!${priceMsg}`,
    { parse_mode: "Markdown", reply_markup: mainKeyboard },
  );
});

// Handle /edit <id> <new_price> [direction]
bot.onText(
  /\/edit(?:\s+(\S+)\s+(\d+(?:\.\d+)?)(?:\s+(above|below|up|down|go_above|go_below))?)?/,
  async (msg, match) => {
    const chatId = msg.chat.id;
    userStates[chatId] = null; // Reset state

    const alertId = match[1];
    const newPriceStr = match[2];
    const dirInput = match[3];

    if (!alertId || !newPriceStr) {
      return bot.sendMessage(
        chatId,
        "⚠️ Usage: \`/edit <ALERT_ID> <NEW_PRICE> [above/below]\`\nExample: \`/edit 1686235492000 1.25 below\`",
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    }

    const newPrice = parseFloat(newPriceStr);
    const triggers = readTriggers();
    const triggerIdx = triggers.findIndex(
      (t) => t.id === alertId && t.chatId === chatId,
    );

    if (triggerIdx === -1) {
      return bot.sendMessage(chatId, `❌ Alert ID \`${alertId}\` not found.`, {
        parse_mode: "Markdown",
        reply_markup: mainKeyboard,
      });
    }

    const trigger = triggers[triggerIdx];
    bot.sendMessage(
      chatId,
      `⏳ Fetching live price for *${trigger.symbol}*...`,
      { parse_mode: "Markdown" },
    );

    const currentPrice = await verifySymbolAndGetPrice(trigger.symbol);
    if (currentPrice === null) {
      return bot.sendMessage(
        chatId,
        `❌ Error: Could not verify price for ${trigger.symbol}. Try again.`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    }

    if (dirInput) {
      let direction = "above";
      if (["below", "down", "go_below"].includes(dirInput.toLowerCase())) {
        direction = "below";
      }

      trigger.targetPrice = newPrice;
      trigger.direction = direction;
      writeTriggers(triggers);

      return bot.sendMessage(
        chatId,
        `✅ **Alert Updated Successfully!**\n\n` +
          `🪙 Symbol: *${trigger.symbol}*\n` +
          `💵 Current Price: *$${currentPrice}*\n` +
          `🎯 New Target Price: *$${newPrice}*\n` +
          `🔔 Trigger Condition: When price goes *${direction === "above" ? "above 📈" : "below 📉"}*`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    }

    // Prompt for manual direction selection using inline buttons
    userStates[chatId] = {
      action: "edit_direction",
      alertId: trigger.id,
      symbol: trigger.symbol,
      newPrice,
      currentPrice,
    };
    const inlineKeyboard = [
      [
        { text: "📈 Go Above", callback_data: "editdir_above" },
        { text: "📉 Go Below", callback_data: "editdir_below" },
      ],
    ];
    bot.sendMessage(
      chatId,
      `🎯 New Target Price: *$${newPrice}*\n` +
        `Current price of *${trigger.symbol}* is *$${currentPrice}*.\n\n` +
        `Choose when to trigger the alert:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      },
    );
  },
);

// ─── CALLBACK QUERY HANDLER (Buttons) ──────────────────────────────────────────

bot.on("callback_query", async (callbackQuery) => {
  try {
    const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;

  // Acknowledge the callback query
  bot.answerCallbackQuery(callbackQuery.id);

  if (data === "menu_add") {
    userStates[chatId] = { action: "add_symbol" };
    const favs = getUserFavorites(chatId);
    if (favs.length > 0) {
      const keyboardRows = [];
      for (let i = 0; i < favs.length; i += 2) {
        const row = [
          { text: `⭐ ${favs[i]}`, callback_data: `favselect_${favs[i]}` },
        ];
        if (i + 1 < favs.length) {
          row.push({
            text: `⭐ ${favs[i + 1]}`,
            callback_data: `favselect_${favs[i + 1]}`,
          });
        }
        keyboardRows.push(row);
      }
      await bot.sendMessage(
        chatId,
        "➕ **Add Alert:**\nPlease choose a coin from your *Favorites* below, or type the symbol manually (e.g., BTC, ETH):",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: keyboardRows,
          },
        },
      );
    } else {
      await bot.sendMessage(
        chatId,
        "➕ **Add Alert:**\nEnter coin symbol (e.g. BTC, ETH, SIRENUSDT):",
        { reply_markup: mainKeyboard },
      );
    }
  } else if (data === "menu_list") {
    await sendAlertsList(chatId);
  } else if (data === "menu_price") {
    userStates[chatId] = { action: "check_price_symbol" };
    await bot.sendMessage(
      chatId,
      "🔍 Enter coin symbol (e.g. BTC, ETH, SIRENUSDT):",
      { reply_markup: mainKeyboard },
    );
  } else if (data.startsWith("delete_")) {
    const alertId = data.substring(7);
    const triggers = readTriggers();
    const index = triggers.findIndex(
      (t) => t.id === alertId && t.chatId === chatId,
    );

    if (index !== -1) {
      const sym = triggers[index].symbol;
      const price = triggers[index].targetPrice;
      triggers.splice(index, 1);
      writeTriggers(triggers);

      const currentPrice = await verifySymbolAndGetPrice(sym);
      const priceMsg =
        currentPrice !== null ? ` (Current Price: *$${currentPrice}*)` : "";

      await bot.sendMessage(
        chatId,
        `🗑️ Alert for *${sym}* at *$${price}* has been deleted successfully!${priceMsg}`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
      // Refresh the list
      await sendAlertsList(chatId, messageId);
    } else {
      await bot.sendMessage(chatId, "❌ Alert not found or already deleted.", {
        reply_markup: mainKeyboard,
      });
    }
  } else if (data.startsWith("edit_")) {
    const alertId = data.substring(5);
    const triggers = readTriggers();
    const trigger = triggers.find(
      (t) => t.id === alertId && t.chatId === chatId,
    );

    if (trigger) {
      userStates[chatId] = {
        action: "edit_price",
        alertId: trigger.id,
        symbol: trigger.symbol,
      };
      await bot.sendMessage(
        chatId,
        `✏️ **Editing Alert for ${trigger.symbol}** (Current Target: $${trigger.targetPrice})\n\n` +
          `Please type the *new target price*:`,
        { reply_markup: mainKeyboard },
      );
    } else {
      await bot.sendMessage(chatId, "❌ Alert not found.", {
        reply_markup: mainKeyboard,
      });
    }
  } else if (data.startsWith("deleterem_")) {
    const reminderId = data.substring(10);
    const reminders = readReminders();
    const index = reminders.findIndex(
      (r) => r.id === reminderId && r.chatId === chatId,
    );

    if (index !== -1) {
      const note = reminders[index].note;
      reminders.splice(index, 1);
      writeReminders(reminders);

      await bot.sendMessage(
        chatId,
        `🗑️ Reminder *"${note}"* has been deleted successfully!`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
      // Refresh list
      await sendRemindersList(chatId, messageId);
    } else {
      await bot.sendMessage(
        chatId,
        "❌ Reminder not found or already deleted.",
        {
          reply_markup: mainKeyboard,
        },
      );
    }
  } else if (data.startsWith("editrem_note_")) {
    const reminderId = data.substring(13);
    const reminders = readReminders();
    const reminder = reminders.find(
      (r) => r.id === reminderId && r.chatId === chatId,
    );

    if (reminder) {
      userStates[chatId] = {
        action: "edit_reminder_note",
        reminderId: reminder.id,
      };
      await bot.sendMessage(
        chatId,
        `✏️ **Editing Note for Reminder**\n` +
          `Current Note: *${reminder.note}*\n\n` +
          `Please type the *new note*:`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    } else {
      await bot.sendMessage(chatId, "❌ Reminder not found.", {
        reply_markup: mainKeyboard,
      });
    }
  } else if (data.startsWith("editrem_time_")) {
    const reminderId = data.substring(13);
    const reminders = readReminders();
    const reminder = reminders.find(
      (r) => r.id === reminderId && r.chatId === chatId,
    );

    if (reminder) {
      userStates[chatId] = {
        action: "edit_reminder_time",
        reminderId: reminder.id,
      };
      const currentFormatted = new Date(reminder.time).toLocaleString("en-GB", {
        hour12: false,
      });
      await bot.sendMessage(
        chatId,
        `📅 **Editing Time for Reminder**\n` +
          `Current Time: \`${currentFormatted}\`\n\n` +
          `Please type the *new date & time* in format \`DD-MM-YYYY HH:MM\` (e.g. \`14-06-2026 15:30\`):`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    } else {
      await bot.sendMessage(chatId, "❌ Reminder not found.", {
        reply_markup: mainKeyboard,
      });
    }
  } else if (data.startsWith("setdir_")) {
    const direction = data.substring(7); // "above" or "below"
    const state = userStates[chatId];
    if (!state || state.action !== "add_direction") {
      return bot.sendMessage(
        chatId,
        "❌ Wizard session expired or invalid. Please add alert again.",
        { reply_markup: mainKeyboard },
      );
    }

    const { symbol, targetPrice, currentPrice } = state;
    userStates[chatId] = null; // Clear state

    const newTrigger = {
      id: Date.now().toString(),
      symbol,
      targetPrice,
      direction,
      chatId,
      createdAt: new Date().toISOString(),
    };

    const triggers = readTriggers();
    triggers.push(newTrigger);
    writeTriggers(triggers);

    const dirText = direction === "above" ? "above 📈" : "below 📉";
    const successMsg =
      `✅ **Alert Added Successfully!**\n\n` +
      `🪙 Symbol: *${symbol}*\n` +
      `💵 Current Price: *$${currentPrice}*\n` +
      `🎯 Target Price: *$${targetPrice}*\n` +
      `🔔 Trigger Condition: When price goes *${dirText}*\n` +
      `🆔 Alert ID: \`${newTrigger.id}\``;

    // Edit the inline button message to show success
    await bot.editMessageText(successMsg, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
    });

    // Also send a dummy message to keep the main keyboard present
    await bot.sendMessage(chatId, "Use main keyboard for further actions.", {
      reply_markup: mainKeyboard,
    });
  } else if (data.startsWith("editdir_")) {
    const direction = data.substring(8); // "above" or "below"
    const state = userStates[chatId];
    if (!state || state.action !== "edit_direction") {
      return bot.sendMessage(
        chatId,
        "❌ Wizard session expired or invalid. Please edit alert again.",
        { reply_markup: mainKeyboard },
      );
    }

    const { alertId, symbol, newPrice, currentPrice } = state;
    userStates[chatId] = null; // Clear state

    const triggers = readTriggers();
    const triggerIdx = triggers.findIndex(
      (t) => t.id === alertId && t.chatId === chatId,
    );

    if (triggerIdx === -1) {
      return bot.sendMessage(
        chatId,
        "❌ Alert not found or was deleted during edit.",
        { reply_markup: mainKeyboard },
      );
    }

    const trigger = triggers[triggerIdx];
    trigger.targetPrice = newPrice;
    trigger.direction = direction;
    writeTriggers(triggers);

    const dirText = direction === "above" ? "above 📈" : "below 📉";
    const successMsg =
      `✅ **Alert Updated Successfully!**\n\n` +
      `🪙 Symbol: *${symbol}*\n` +
      `💵 Current Price: *$${currentPrice}*\n` +
      `🎯 New Target Price: *$${newPrice}*\n` +
      `🔔 Trigger Condition: When price goes *${dirText}*`;

    await bot.editMessageText(successMsg, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
    });

    await bot.sendMessage(chatId, "Use main keyboard for further actions.", {
      reply_markup: mainKeyboard,
    });
  } else if (data === "fav_add") {
    userStates[chatId] = { action: "fav_add_symbol" };
    await bot.sendMessage(
      chatId,
      "⭐ **Add Favorite:** \nPlease type the coin symbol you want to add to your favorites (e.g. BTC, ETH, SIREN):",
      { parse_mode: "Markdown", reply_markup: mainKeyboard },
    );
  } else if (data === "fav_del") {
    const favs = getUserFavorites(chatId);
    if (favs.length === 0) {
      return bot.sendMessage(chatId, "You have no favorite coins to delete.", {
        reply_markup: mainKeyboard,
      });
    }
    const keyboardRows = [];
    favs.forEach((fav) => {
      keyboardRows.push([
        { text: `❌ Remove ${fav}`, callback_data: `favdel_${fav}` },
      ]);
    });
    await bot.sendMessage(
      chatId,
      "🗑️ **Delete Favorite:**\nClick on a coin below to remove it from your favorites:",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: keyboardRows,
        },
      },
    );
  } else if (data.startsWith("favdel_")) {
    const symbol = data.substring(7);
    const removed = removeUserFavorite(chatId, symbol);
    if (removed) {
      await bot.sendMessage(chatId, `✅ *${symbol}* removed from favorites.`, {
        parse_mode: "Markdown",
      });
    } else {
      await bot.sendMessage(chatId, `❌ *${symbol}* not found in favorites.`, {
        parse_mode: "Markdown",
      });
    }
    await sendFavoritesMenu(chatId);
  } else if (data === "fav_prices") {
    const favs = getUserFavorites(chatId);
    if (favs.length === 0) {
      return bot.sendMessage(chatId, "You have no favorite coins.", {
        reply_markup: mainKeyboard,
      });
    }
    await bot.sendMessage(
      chatId,
      `⏳ Fetching live prices for your ${favs.length} favorites...`,
    );
    let report = "⭐️ *Favorites Live Market Status:*\n\n";
    for (const fav of favs) {
      const details = await getMexcSymbolDetails(fav);
      if (details) {
        const changeIcon = details.changePerc >= 0 ? "🟢" : "🔴";
        report += `🪙 *${fav}*: *$${details.price}* (${changeIcon} ${details.changePerc.toFixed(2)}%) | Vol: ${details.volume}\n`;
      } else {
        report += `🪙 *${fav}*: Fetching failed\n`;
      }
      await delay(100); // polite delay
    }
    await bot.sendMessage(chatId, report, {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard,
    });
  } else if (data.startsWith("favselect_")) {
    const symbol = data.substring(10);
    bot.sendMessage(chatId, `⏳ Fetching price for *${symbol}*...`, {
      parse_mode: "Markdown",
    });
    const details = await getMexcSymbolDetails(symbol);
    if (!details) {
      return bot.sendMessage(
        chatId,
        `❌ Error: Could not verify price for *${symbol}*. Please try again.`,
        { reply_markup: mainKeyboard },
      );
    }
    userStates[chatId] = {
      action: "add_price",
      symbol,
      currentPrice: details.price,
    };
    await bot.sendMessage(
      chatId,
      `${formatMexcDetails(symbol, details)}\n\nNow, enter your *target price* for the alert:`,
      { parse_mode: "Markdown", reply_markup: mainKeyboard },
    );
  }
  } catch (err) {
    logError(err, "Telegram callback_query");
  }
});

// ─── CONVERSATIONAL WIZARD & KEYBOARD TEXT HANDLER ────────────────────────────

bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : "";

  // Ignore commands handled by bot.onText
  if (text.startsWith("/")) return;

  // Handle Bottom Reply Keyboard Clicks
  if (text === "➕ Add Alert") {
    userStates[chatId] = { action: "add_symbol" };
    const favs = getUserFavorites(chatId);
    if (favs.length > 0) {
      const keyboardRows = [];
      for (let i = 0; i < favs.length; i += 2) {
        const row = [
          { text: `⭐ ${favs[i]}`, callback_data: `favselect_${favs[i]}` },
        ];
        if (i + 1 < favs.length) {
          row.push({
            text: `⭐ ${favs[i + 1]}`,
            callback_data: `favselect_${favs[i + 1]}`,
          });
        }
        keyboardRows.push(row);
      }
      return bot.sendMessage(
        chatId,
        "➕ **Add Alert Wizard:**\nPlease choose a coin from your *Favorites* below, or type the symbol manually (e.g., BTC, ETH):",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: keyboardRows,
          },
        },
      );
    } else {
      return bot.sendMessage(
        chatId,
        "➕ **Add Alert Wizard:**\nEnter coin symbol (e.g. BTC, ETH, SIRENUSDT):",
        { reply_markup: mainKeyboard },
      );
    }
  }

  if (text === "📋 List Alerts") {
    userStates[chatId] = null;
    return sendAlertsList(chatId);
  }

  if (text === "💰 Check Price") {
    userStates[chatId] = { action: "check_price_symbol" };
    return bot.sendMessage(
      chatId,
      "🔍 Enter coin symbol to check live price (e.g. BTC, ETH, SIRENUSDT):",
      { reply_markup: mainKeyboard },
    );
  }

  if (text === "⭐️ Fav Coins") {
    userStates[chatId] = null;
    return sendFavoritesMenu(chatId);
  }

  if (text === "⏰ Set Reminder") {
    userStates[chatId] = { action: "add_reminder_note" };
    return bot.sendMessage(
      chatId,
      "⏰ **Set Reminder (Step 1 of 2):**\n\nPlease enter the reminder note/message (e.g., *Meeting with team*, *Buy groceries*):",
      { parse_mode: "Markdown", reply_markup: mainKeyboard },
    );
  }

  if (text === "🎙️ Voice Reminder") {
    userStates[chatId] = { action: "add_voice_reminder_file" };
    return bot.sendMessage(
      chatId,
      "🎙️ **Set Voice Reminder (Step 1 of 2):**\n\nPlease record and send your voice note/message now:",
      { parse_mode: "Markdown", reply_markup: mainKeyboard },
    );
  }

  if (text === "📋 List Reminders") {
    userStates[chatId] = null;
    return sendRemindersList(chatId);
  }

  if (text === "🗣️ Speak Message") {
    userStates[chatId] = { action: "speak_text" };
    return bot.sendMessage(
      chatId,
      "🗣️ **Speak Message:**\n\nPlease type the text message you want me to convert to speech and stream immediately:",
      { parse_mode: "Markdown", reply_markup: mainKeyboard },
    );
  }

  if (text === "🧹 Clear Queue") {
    userStates[chatId] = null;
    clearAudioQueue();
    return bot.sendMessage(
      chatId,
      "🧹 **Audio Stream Queue has been cleared successfully!**",
      { parse_mode: "Markdown", reply_markup: mainKeyboard },
    );
  }

  if (text === "❓ Help") {
    userStates[chatId] = null;
    const dashboard = await getDefaultMarketDashboard();
    return bot.sendMessage(chatId, `${getHelpMessage()}\n\n${dashboard}`, {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard,
    });
  }

  const state = userStates[chatId];
  if (!state) return;

  if (state.action === "speak_text") {
    if (!text) {
      return bot.sendMessage(
        chatId,
        "⚠️ Please enter some text for me to speak:",
        { reply_markup: mainKeyboard },
      );
    }
    userStates[chatId] = null; // Clear state
    bot.sendMessage(
      chatId,
      "🗣️ Generating audio and sending to stream queue...",
      { reply_markup: mainKeyboard },
    );

    try {
      await selectAudioForSpeak(text, "en"); // Use Hindi TTS which handles mixed Hinglish beautifully
      return bot.sendMessage(chatId, "✅ Sent to stream queue!", {
        reply_markup: mainKeyboard,
      });
    } catch (e) {
      console.error("Error generating speak audio:", e);
      return bot.sendMessage(
        chatId,
        `❌ Failed to generate audio: ${e.message}`,
        { reply_markup: mainKeyboard },
      );
    }
  }

  if (state.action === "add_voice_reminder_file") {
    const voice = msg.voice || msg.audio;
    if (!voice) {
      return bot.sendMessage(
        chatId,
        "⚠️ **Please record and send a voice note/message.**\n" +
          "If you want to cancel, please click any button on the bottom menu.",
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    }

    bot.sendMessage(
      chatId,
      "🎙️ Voice note received. Downloading and preparing your reminder...",
      { reply_markup: mainKeyboard },
    );

    try {
      const fileId = voice.file_id;
      const fileLink = await bot.getFileLink(fileId);
      const savedPath = await saveVoiceMessage(fileLink, "voice_reminder");

      // Advance to step 2 (getting date and time)
      userStates[chatId] = {
        action: "add_reminder_time",
        type: "voice",
        filePath: savedPath,
        note: "[Voice Reminder]",
      };

      return bot.sendMessage(
        chatId,
        `🎙️ **Set Voice Reminder (Step 2 of 2):**\n\n` +
          `✅ Voice message prepared successfully!\n\n` +
          `Please enter the *date & time* in format \`DD-MM-YYYY HH:MM\` (e.g., \`14-06-2026 15:30\`):`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    } catch (err) {
      console.error("Error setting voice reminder:", err);
      return bot.sendMessage(
        chatId,
        `❌ Failed to process voice note: ${err.message}`,
        { reply_markup: mainKeyboard },
      );
    }
  }

  if (state.action === "add_reminder_note") {
    if (!text) {
      return bot.sendMessage(
        chatId,
        "⚠️ Please enter a valid non-empty note/message for the reminder:",
        { reply_markup: mainKeyboard },
      );
    }
    userStates[chatId] = {
      action: "add_reminder_time",
      note: text,
    };
    return bot.sendMessage(
      chatId,
      `⏰ **Set Reminder (Step 2 of 2):**\n\n` +
        `📌 Note: *${text}*\n\n` +
        `Please enter the *date & time* in format \`DD-MM-YYYY HH:MM\` (e.g., \`14-06-2026 15:30\`):`,
      { parse_mode: "Markdown", reply_markup: mainKeyboard },
    );
  }

  if (state.action === "add_reminder_time") {
    const { note } = state;
    const regex = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/;
    const match = text.match(regex);
    if (!match) {
      return bot.sendMessage(
        chatId,
        "⚠️ **Invalid format!** Please use the format `DD-MM-YYYY HH:MM`.\n" +
          "Example: `14-06-2026 18:30`",
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    }

    const [_, day, month, year, hour, minute] = match;
    const reminderDate = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      0,
    );

    if (isNaN(reminderDate.getTime())) {
      return bot.sendMessage(
        chatId,
        "⚠️ **Invalid Date!** Please check your date and time values.",
        { reply_markup: mainKeyboard },
      );
    }

    const now = new Date();
    if (reminderDate <= now) {
      return bot.sendMessage(
        chatId,
        `⚠️ **Time must be in the future!**\n` +
          `Selected time: *${text}*\n` +
          `Current time: *${now.toLocaleString("en-GB")}*`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    }

    // Save reminder
    const reminders = readReminders();
    const newReminder = {
      id: Date.now().toString() + "_" + Math.random().toString(36).substr(2, 5),
      chatId,
      type: state.type || "text",
      filePath: state.filePath || null,
      note,
      time: reminderDate.toISOString(),
      createdAt: new Date().toISOString(),
    };
    reminders.push(newReminder);
    writeReminders(reminders);

    userStates[chatId] = null; // Clear state

    const displayNote = state.type === "voice" ? "🎙️ [Voice Reminder]" : note;

    return bot.sendMessage(
      chatId,
      `✅ **Reminder set successfully!**\n\n` +
        `📌 **Note:** *${displayNote}*\n` +
        `📅 **Time:** *${text}*`,
      { parse_mode: "Markdown", reply_markup: mainKeyboard },
    );
  }

  if (state.action === "edit_reminder_note") {
    const { reminderId } = state;
    const reminders = readReminders();
    const reminder = reminders.find((r) => r.id === reminderId);

    if (reminder) {
      const oldNote = reminder.note;
      reminder.note = text;
      writeReminders(reminders);
      userStates[chatId] = null;

      return bot.sendMessage(
        chatId,
        `✅ **Reminder note updated successfully!**\n\n` +
          `Old Note: *${oldNote}*\n` +
          `New Note: *${text}*`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    } else {
      userStates[chatId] = null;
      return bot.sendMessage(chatId, "❌ Reminder not found.", {
        reply_markup: mainKeyboard,
      });
    }
  }

  if (state.action === "edit_reminder_time") {
    const { reminderId } = state;
    const reminders = readReminders();
    const reminder = reminders.find((r) => r.id === reminderId);

    if (reminder) {
      const regex = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/;
      const match = text.match(regex);
      if (!match) {
        return bot.sendMessage(
          chatId,
          "⚠️ **Invalid format!** Please enter date & time in `DD-MM-YYYY HH:MM`.\n" +
            "Example: `14-06-2026 18:30`",
          { parse_mode: "Markdown", reply_markup: mainKeyboard },
        );
      }

      const [_, day, month, year, hour, minute] = match;
      const reminderDate = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        0,
      );

      if (isNaN(reminderDate.getTime())) {
        return bot.sendMessage(
          chatId,
          "⚠️ **Invalid Date!** Please check the values.",
          { reply_markup: mainKeyboard },
        );
      }

      const now = new Date();
      if (reminderDate <= now) {
        return bot.sendMessage(
          chatId,
          `⚠️ **Time must be in the future!**\n` +
            `Selected time: *${text}*\n` +
            `Current time: *${now.toLocaleString("en-GB")}*`,
          { parse_mode: "Markdown", reply_markup: mainKeyboard },
        );
      }

      const oldTimeStr = new Date(reminder.time).toLocaleString("en-GB", {
        hour12: false,
      });
      reminder.time = reminderDate.toISOString();
      writeReminders(reminders);
      userStates[chatId] = null;

      return bot.sendMessage(
        chatId,
        `✅ **Reminder time updated successfully!**\n\n` +
          `📌 Note: *${reminder.note}*\n` +
          `Old Time: *${oldTimeStr}*\n` +
          `New Time: *${text}*`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    } else {
      userStates[chatId] = null;
      return bot.sendMessage(chatId, "❌ Reminder not found.", {
        reply_markup: mainKeyboard,
      });
    }
  }

  if (state.action === "check_price_symbol") {
    userStates[chatId] = null; // Reset state
    let symbol = text.toUpperCase();

    bot.sendMessage(chatId, `⏳ Fetching price for *${symbol}*...`, {
      parse_mode: "Markdown",
    });

    let details = await getMexcSymbolDetails(symbol);
    if (details === null && !symbol.endsWith("USDT")) {
      const usdtSymbol = symbol + "USDT";
      const usdtDetails = await getMexcSymbolDetails(usdtSymbol);
      if (usdtDetails !== null) {
        symbol = usdtSymbol;
        details = usdtDetails;
      }
    }

    if (details === null) {
      return bot.sendMessage(
        chatId,
        `❌ Symbol *${symbol}* not found on MEXC Spot.`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    }

    bot.sendMessage(chatId, formatMexcDetails(symbol, details), {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard,
    });
  } else if (state.action === "add_symbol") {
    let symbol = text.toUpperCase();

    bot.sendMessage(chatId, `⏳ Verifying symbol *${symbol}* on MEXC...`, {
      parse_mode: "Markdown",
    });

    let details = await getMexcSymbolDetails(symbol);
    if (details === null && !symbol.endsWith("USDT")) {
      const usdtSymbol = symbol + "USDT";
      const usdtDetails = await getMexcSymbolDetails(usdtSymbol);
      if (usdtDetails !== null) {
        symbol = usdtSymbol;
        details = usdtDetails;
      }
    }

    if (details === null) {
      return bot.sendMessage(
        chatId,
        `❌ Symbol *${symbol}* not found on MEXC Spot.\n\nPlease enter a valid symbol (e.g. BTC, ETH, SIRENUSDT):`,
        { reply_markup: mainKeyboard },
      );
    }

    // Symbol is valid, move to price step
    userStates[chatId] = {
      action: "add_price",
      symbol,
      currentPrice: details.price,
    };
    bot.sendMessage(
      chatId,
      `${formatMexcDetails(symbol, details)}\n\nNow, enter your *target price* for the alert:`,
      { parse_mode: "Markdown", reply_markup: mainKeyboard },
    );
  } else if (state.action === "add_price") {
    const targetPrice = parseFloat(text);
    const { symbol, currentPrice } = state;

    if (isNaN(targetPrice) || targetPrice <= 0) {
      return bot.sendMessage(
        chatId,
        `⚠️ Please enter a valid positive number for the target price:\n(Current price of *${symbol}* is *$${currentPrice}*)`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    }

    // Instead of completing, transition to choosing direction
    userStates[chatId] = {
      action: "add_direction",
      symbol,
      targetPrice,
      currentPrice,
    };

    const inlineKeyboard = [
      [
        { text: "📈 Go Above", callback_data: "setdir_above" },
        { text: "📉 Go Below", callback_data: "setdir_below" },
      ],
    ];
    bot.sendMessage(
      chatId,
      `🎯 Target Price: *$${targetPrice}*\n` +
        `Current price of *${symbol}* is *$${currentPrice}*.\n\n` +
        `Choose when to trigger the alert:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      },
    );
  } else if (state.action === "edit_price") {
    const newPrice = parseFloat(text);
    const { alertId, symbol } = state;

    if (isNaN(newPrice) || newPrice <= 0) {
      const currentPrice = await verifySymbolAndGetPrice(symbol);
      const priceMsg =
        currentPrice !== null
          ? `\n(Current price of *${symbol}* is *$${currentPrice}*)`
          : "";
      return bot.sendMessage(
        chatId,
        `⚠️ Please enter a valid positive number for the target price:${priceMsg}`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    }

    bot.sendMessage(chatId, `⏳ Fetching live price for *${symbol}*...`, {
      parse_mode: "Markdown",
    });

    const currentPrice = await verifySymbolAndGetPrice(symbol);
    if (currentPrice === null) {
      userStates[chatId] = null;
      return bot.sendMessage(
        chatId,
        `❌ Error: Could not fetch price. Try editing using \`/edit ${alertId} ${newPrice}\``,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    }

    // Instead of completing, transition to choosing direction
    userStates[chatId] = {
      action: "edit_direction",
      alertId,
      symbol,
      newPrice,
      currentPrice,
    };

    const inlineKeyboard = [
      [
        { text: "📈 Go Above", callback_data: "editdir_above" },
        { text: "📉 Go Below", callback_data: "editdir_below" },
      ],
    ];
    bot.sendMessage(
      chatId,
      `🎯 New Target Price: *$${newPrice}*\n` +
        `Current price of *${symbol}* is *$${currentPrice}*.\n\n` +
        `Choose when to trigger the alert:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      },
    );
  } else if (state.action === "fav_add_symbol") {
    userStates[chatId] = null; // Clear state
    let symbol = text.toUpperCase();

    bot.sendMessage(chatId, `⏳ Verifying symbol *${symbol}* on MEXC...`, {
      parse_mode: "Markdown",
    });

    let details = await getMexcSymbolDetails(symbol);
    if (details === null && !symbol.endsWith("USDT")) {
      const usdtSymbol = symbol + "USDT";
      const usdtDetails = await getMexcSymbolDetails(usdtSymbol);
      if (usdtDetails !== null) {
        symbol = usdtSymbol;
        details = usdtDetails;
      }
    }

    if (details === null) {
      return bot.sendMessage(
        chatId,
        `❌ Symbol *${symbol}* not found on MEXC Spot.\n\nPlease check the symbol and try again.`,
        { reply_markup: mainKeyboard },
      );
    }

    const added = addUserFavorite(chatId, symbol);
    if (added) {
      await bot.sendMessage(
        chatId,
        `⭐ *${symbol}* has been added to your favorites!\n\n` +
          formatMexcDetails(symbol, details),
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    } else {
      await bot.sendMessage(
        chatId,
        `ℹ️ *${symbol}* is already in your favorites.`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard },
      );
    }

    // Show updated favorites menu
    await sendFavoritesMenu(chatId);
  }
  } catch (err) {
    logError(err, "Telegram message");
  }
});

// Helper function to format and send favorites list
async function sendFavoritesMenu(chatId) {
  const favs = getUserFavorites(chatId);
  let msgText = "⭐️ *Your Favorite Coins:*\n\n";
  if (favs.length === 0) {
    msgText +=
      "You have no favorite coins yet. Add some to quickly check prices or set alerts!";
  } else {
    favs.forEach((fav, idx) => {
      msgText += `${idx + 1}. *${fav}*\n`;
    });
  }

  const inlineKeyboard = [[{ text: "➕ Add Fav", callback_data: "fav_add" }]];

  if (favs.length > 0) {
    inlineKeyboard[0].push({ text: "🗑️ Delete Fav", callback_data: "fav_del" });
    inlineKeyboard.push([
      { text: "💰 Check Fav Prices", callback_data: "fav_prices" },
    ]);
  }

  await bot.sendMessage(chatId, msgText, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
  });
}

// ─── PRICE MONITORING ENGINE ─────────────────────────────────────────────────

async function monitorMarket() {
  try {
    const triggers = readTriggers();
    if (triggers.length > 0) {
      // Get unique symbols currently in triggers
      const uniqueSymbols = [...new Set(triggers.map((t) => t.symbol))];
      const livePrices = await getPricesForSymbols(uniqueSymbols);

      let triggersChanged = false;
      const remainingTriggers = [];

      for (const trigger of triggers) {
        const currentPrice = livePrices[trigger.symbol];
        if (currentPrice === undefined || currentPrice === null) {
          remainingTriggers.push(trigger);
          continue;
        }

        let isTriggered = false;
        if (
          trigger.direction === "above" &&
          currentPrice >= trigger.targetPrice
        ) {
          isTriggered = true;
        } else if (
          trigger.direction === "below" &&
          currentPrice <= trigger.targetPrice
        ) {
          isTriggered = true;
        }

        if (isTriggered) {
          triggersChanged = true;
          const dirText =
            trigger.direction === "above"
              ? "crossed ABOVE 📈"
              : "crossed BELOW 📉";
          const message =
            `🚨 *PRICE ALERT TRIGGERED!* 🚨\n\n` +
            `🪙 Symbol: *${trigger.symbol}*\n` +
            `🎯 Target Price: *$${trigger.targetPrice}*\n` +
            `💵 Current Price: *$${currentPrice}*\n\n` +
            `Price has *${dirText}* your alert target. This alert has been removed.`;

          try {
            await bot.sendMessage(trigger.chatId, message, {
              parse_mode: "Markdown",
              reply_markup: mainKeyboard,
            });
            console.log(
              `Alert sent for ${trigger.symbol} to chatId ${trigger.chatId} at price ${currentPrice}`,
            );
          } catch (error) {
            console.error(
              `Error sending telegram alert to ${trigger.chatId}:`,
              error.message,
            );
          }

          // Generate audio like mail_reads
          try {
            await selectAudio(
              "crypto",
              { coin: trigger.symbol, price: currentPrice },
              "en",
            );
          } catch (audioError) {
            console.error("Error generating audio alert:", audioError.message);
          }
        } else {
          remainingTriggers.push(trigger);
        }
      }

      if (triggersChanged) {
        writeTriggers(remainingTriggers);
      }
    }
  } catch (err) {
    logError(err, "monitorMarket loop");
  } finally {
    // Check again 10 seconds after this run finishes
    setTimeout(monitorMarket, 10000);
  }
}

async function monitorReminders() {
  try {
    const reminders = readReminders();
    if (reminders.length > 0) {
      const now = new Date();
      let remindersChanged = false;
      const remainingReminders = [];

      for (const reminder of reminders) {
        const reminderTime = new Date(reminder.time);
        if (reminderTime <= now) {
          remindersChanged = true;
          const message = `🔔 **REMINDER ALERT!** 🔔\n\n📌 *${reminder.note}*`;

          try {
            await bot.sendMessage(reminder.chatId, message, {
              parse_mode: "Markdown",
              reply_markup: mainKeyboard,
            });
            console.log(
              `Reminder sent for note "${reminder.note}" to chatId ${reminder.chatId}`,
            );
          } catch (error) {
            console.error(
              `Error sending telegram reminder to ${reminder.chatId}:`,
              error.message,
            );
          }

          // Generate audio for reminder
          try {
            if (reminder.type === "voice" && reminder.filePath) {
              queueAudio("reminder", reminder.filePath);
            } else {
              await selectAudioForReminder(
                `Hello sir, You reminder is: ${reminder.note}`,
                "en",
              );
            }
          } catch (audioError) {
            console.error(
              "Error generating reminder audio alert:",
              audioError.message,
            );
          }
        } else {
          remainingReminders.push(reminder);
        }
      }

      if (remindersChanged) {
        writeReminders(remainingReminders);
      }
    }
  } catch (err) {
    logError(err, "monitorReminders loop");
  } finally {
    // Check again every 5 seconds
    setTimeout(monitorReminders, 5000);
  }
}

// Start the monitoring engines
console.log("Price monitoring and reminders engines started.");
monitorMarket();
monitorReminders();

// Listen for voice messages
bot.on("voice", async (msg) => {
  const chatId = msg.chat.id;
  if (
    userStates[chatId] &&
    userStates[chatId].action === "add_voice_reminder_file"
  ) {
    return; // Ignored globally so conversational wizard handles it
  }
  const fileId = msg.voice.file_id;
  await handleIncomingAudioFile(chatId, fileId);
});

// Listen for audio messages
bot.on("audio", async (msg) => {
  const chatId = msg.chat.id;
  if (
    userStates[chatId] &&
    userStates[chatId].action === "add_voice_reminder_file"
  ) {
    return; // Ignored globally so conversational wizard handles it
  }
  const fileId = msg.audio.file_id;
  await handleIncomingAudioFile(chatId, fileId);
});

async function handleIncomingAudioFile(chatId, fileId) {
  bot.sendMessage(
    chatId,
    "🎙️ Voice note received. Downloading and preparing stream...",
    { reply_markup: mainKeyboard },
  );
  try {
    const fileLink = await bot.getFileLink(fileId);
    console.log(`[Bot] Download link for voice message: ${fileLink}`);
    await queueVoiceAudio(fileLink);
    await bot.sendMessage(
      chatId,
      "✅ Voice note successfully prepared and added to stream queue!",
      { reply_markup: mainKeyboard },
    );
  } catch (e) {
    logError(e, "handleIncomingAudioFile");
    await bot.sendMessage(
      chatId,
      `❌ Failed to process voice note: ${e.message}`,
      { reply_markup: mainKeyboard },
    );
  }
}
