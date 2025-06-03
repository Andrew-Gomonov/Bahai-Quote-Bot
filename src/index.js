require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { DateTime } = require('luxon');
const Bluebird = require('bluebird');
const { version } = require('../package.json');
const { db, initDatabase: dbInit, DEFAULT_TZ, DEFAULT_DAILY_TIME } = require('./core/db');
const { startScheduler } = require('./core/scheduler');
const { loadQuotes, getRandomQuote, getQuoteById, searchQuotes, sendQuote, formatQuote, getQuotesCount } = require('./bot/quotes');
const { registerCommands } = require('./bot/commands');

// ================== CONFIG ==================
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('\n[ERROR] BOT_TOKEN environment variable not set. Create a .env file with BOT_TOKEN=your_token or export it before running.\n');
  process.exit(1);
}

const COOLDOWN_SEC = process.env.COOLDOWN_SEC ? Number(process.env.COOLDOWN_SEC) : 30;

// ================== DATABASE ==================
let bot;

// Init DB and start bot after setup completes
(async () => {
  await dbInit(); // инициализация базы (создание таблиц)

  // ================== LOAD QUOTES ==================
  loadQuotes(db);

  // ================== BOT INITIALIZATION ==================
  bot = new TelegramBot(TOKEN, { polling: true });
  console.log(`[INFO] Bot v${version} started...`);

  bot.on('polling_error', tgError);
  bot.on('webhook_error', tgError);

  // ================ HELPER FUNCTIONS =================

  // Запускаем отдельный планировщик
  startScheduler(db, bot, getRandomQuote, broadcastToAll);

  // ================== COMMAND HANDLERS ==================

  // Все команды и callback-и теперь регистрируются через отдельный модуль
  registerCommands(bot, db, broadcastToAll, tgError);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('Shutting down...');
    bot.stopPolling();
    db.close();
    process.exit(0);
  });
})();

// Unified Telegram error handler to silence non-fatal API errors (e.g. "query is too old")
function tgError(err) {
  if (!err) return;
  if (err.code === 'ETELEGRAM') {
    const desc = err.response?.body?.description || err.description || err.message || '';
    // Ignore frequent, non-critical errors
    const ignorablePatterns = [
      'query is too old',
      'message is not modified',
      'message to edit not found',
      'bot was blocked by the user',
      'terminated by other getUpdates request'
    ];
    if (ignorablePatterns.some((p) => desc.includes(p))) {
      console.warn('[TG]', desc);
      return;
    }
  }
  console.error('[TG ERROR]', err);
}

process.on('unhandledRejection', tgError);
process.on('rejectionHandled', tgError);

// Trap Bluebird unhandled rejections
Bluebird.onPossiblyUnhandledRejection(tgError);

function broadcastToAll(text, image=null) {
  db.all('SELECT chat_id FROM users WHERE broadcast_enabled = 1', (err, rows) => {
    if (err) return console.error(err);
    rows.forEach((u) => {
      if (image) {
        bot.sendPhoto(u.chat_id, image, { caption: text }).catch(tgError);
      } else {
        bot.sendMessage(u.chat_id, text).catch(tgError);
      }
    });
  });
  console.log('[INFO] Broadcast sent to all users');
} 