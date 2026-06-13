const axios = require("axios");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fetch full details of a symbol from MEXC Spot API
async function getMexcSymbolDetails(symbol) {
  try {
    const cleanSymbol = symbol.trim().toUpperCase();
    const response = await axios.get(
      `https://api.mexc.com/api/v3/ticker/24hr?symbol=${cleanSymbol}`,
    );
    if (response.data && response.data.lastPrice) {
      const d = response.data;
      const lastPrice = parseFloat(d.lastPrice);
      const volume = parseFloat(d.volume).toFixed(2);
      const quoteVolume = parseFloat(d.quoteVolume).toFixed(2);
      const changePerc = parseFloat(d.priceChangePercent) * 100;
      const high = parseFloat(d.highPrice);
      const low = parseFloat(d.lowPrice);
      return {
        price: lastPrice,
        volume: `${volume} (${quoteVolume} USDT)`,
        changePerc,
        high,
        low,
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Format MEXC coin details in a clean Markdown layout
function formatMexcDetails(symbol, details) {
  if (!details) return `🪙 *${symbol}*: Price check failed`;
  const price = details.price !== undefined ? `$${details.price}` : "N/A";
  const volume = details.volume !== undefined ? details.volume : "N/A";
  const change =
    details.changePerc !== undefined
      ? `${details.changePerc.toFixed(2)}%`
      : "N/A";
  const high = details.high !== undefined ? `$${details.high}` : "N/A";
  const low = details.low !== undefined ? `$${details.low}` : "N/A";

  const changeIcon = details.changePerc >= 0 ? "🟢" : "🔴";

  return (
    `🪙 *${symbol}*\n` +
    `├ 💰 Price: *${price}*\n` +
    `├ 📊 24h Vol: *${volume}*\n` +
    `├ 📈 24h High: *${high}* | 📉 Low: *${low}*\n` +
    `└ ${changeIcon} 24h Change: *${change}*`
  );
}

// Verify symbol and get price (compatibility wrapper)
async function verifySymbolAndGetPrice(symbol) {
  const details = await getMexcSymbolDetails(symbol);
  return details ? details.price : null;
}

// Fetch prices for a list of symbols efficiently from MEXC
async function getPricesForSymbols(symbols) {
  const prices = {};
  if (symbols.length === 0) return prices;

  if (symbols.length <= 3) {
    for (const symbol of symbols) {
      const price = await verifySymbolAndGetPrice(symbol);
      if (price !== null) {
        prices[symbol] = price;
      }
      await delay(100);
    }
  } else {
    try {
      const response = await axios.get(
        "https://api.mexc.com/api/v3/ticker/price",
      );
      if (Array.isArray(response.data)) {
        for (const item of response.data) {
          if (symbols.includes(item.symbol)) {
            prices[item.symbol] = parseFloat(item.price);
          }
        }
      }
    } catch (error) {
      console.error("Error fetching all prices from MEXC:", error.message);
    }
  }
  return prices;
}

// Get live dashboard of top cryptos using MEXC Spot
async function getDefaultMarketDashboard() {
  const btcDetails = await getMexcSymbolDetails("BTCUSDT");
  const ethDetails = await getMexcSymbolDetails("ETHUSDT");

  const btcPriceStr = btcDetails
    ? `$${btcDetails.price} (${btcDetails.changePerc >= 0 ? "+" : ""}${btcDetails.changePerc.toFixed(2)}%)`
    : "Fetching...";
  const ethPriceStr = ethDetails
    ? `$${ethDetails.price} (${ethDetails.changePerc >= 0 ? "+" : ""}${ethDetails.changePerc.toFixed(2)}%)`
    : "Fetching...";

  return `💰 *Live Market Status (MEXC Spot):*\n• *BTCUSDT*: ${btcPriceStr}\n• *ETHUSDT*: ${ethPriceStr}`;
}

module.exports = {
  getMexcSymbolDetails,
  formatMexcDetails,
  verifySymbolAndGetPrice,
  getPricesForSymbols,
  getDefaultMarketDashboard,
};
