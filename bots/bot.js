const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const { selectAudio } = require("../generate_audio_files/audio");
const {
  getMexcSymbolDetails,
  formatMexcDetails,
  verifySymbolAndGetPrice,
  getPricesForSymbols,
  getDefaultMarketDashboard,
} = require("./crypto");

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

// User conversation states
const userStates = {};

// ─── REPLY KEYBOARD (Persistent bottom buttons) ──────────────────────────────
const mainKeyboard = {
  keyboard: [
    [{ text: "➕ Add Alert" }, { text: "📋 List Alerts" }],
    [{ text: "💰 Check Price" }, { text: "⭐️ Fav Coins" }],
    [{ text: "❓ Help" }],
  ],
  resize_keyboard: true,
};

// ─── DATABASE FUNCTIONS ───────────────────────────────────────────────────────

const FAVORITES_FILE = path.join(__dirname, "favorites.json");

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
  return `👋 *Welcome to the Crypto Price Alert Bot!*
Aap yahan kisi bhi coin par dynamic triggers set kar sakte hain.

💡 *Commands:*
➕ \`/add <COIN> <PRICE> [above/below]\` - Naya price trigger set karein
   _Example:_ \`/add BTCUSDT 69000 above\` or \`/add SIREN 1.20 below\`
📋 \`/list\` - Apne saare active triggers dekhein aur manage karein
✏️ \`/edit <ID> <NEW_PRICE> [above/below]\` - Alert ki price change karein
❌ \`/delete <ID>\` - Kisi alert ko delete karein
💰 \`/price <COIN>\` - Kisi coin ki live price check karein
❓ \`/help\` - Yeh instructions fir se dekhne ke liye

*Conversational Flow:*
Aap bottom menu buttons ka use karke easily alert create, check, aur manage kar sakte hain!`;
}

// ─── TELEGRAM MESSAGE HANDLERS ────────────────────────────────────────────────

// Handle /start and /help
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
});

// ─── CONVERSATIONAL WIZARD & KEYBOARD TEXT HANDLER ────────────────────────────

bot.on("message", async (msg) => {
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
            await selectAudio("crypto", { coin: trigger.symbol, price: currentPrice }, "hi");
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
    console.error("Error in monitorMarket loop:", err.message);
  } finally {
    // Check again 10 seconds after this run finishes
    setTimeout(monitorMarket, 10000);
  }
}

// Start the monitoring engine
console.log(
  "Price monitoring engine started. Checking prices every 10 seconds...",
);
monitorMarket();
