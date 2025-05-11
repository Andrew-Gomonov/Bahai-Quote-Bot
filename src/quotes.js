const Fuse = require('fuse.js');

let quotesCache = [];
let fuse = null;

function loadQuotes(db, callback) {
  db.all('SELECT id, text FROM quotes', (err, rows) => {
    if (err) {
      console.error('Error loading quotes', err);
      if (callback) callback(err);
      return;
    }
    quotesCache = rows;
    fuse = new Fuse(quotesCache, { keys: ['text'], threshold: 0.4 });
    console.log(`[INFO] Loaded ${quotesCache.length} quotes.`);
    if (callback) callback(null, quotesCache.length);
  });
}

function getRandomQuote() {
  if (!quotesCache.length) return null;
  const idx = Math.floor(Math.random() * quotesCache.length);
  return quotesCache[idx];
}

function getQuoteById(id) {
  return quotesCache.find((q) => q.id === id);
}

function searchQuotes(query, limit = 5) {
  if (!fuse) return [];
  return fuse.search(query, { limit }).map((r) => r.item);
}

function formatQuote(q) {
  return `#${q.id}\n\n${q.text}`;
}

function sendQuote(bot, chatId, quote, opts = {}) {
  return bot
    .sendMessage(chatId, formatQuote(quote), {
      reply_markup: {
        inline_keyboard: [[{ text: '🔄 Ещё', callback_data: 'more' }]],
      },
      ...opts,
    })
    .catch((e) => console.error(e));
}

function getQuotesCount() {
  return quotesCache.length;
}

module.exports = {
  loadQuotes,
  getRandomQuote,
  getQuoteById,
  searchQuotes,
  formatQuote,
  sendQuote,
  getQuotesCount,
}; 