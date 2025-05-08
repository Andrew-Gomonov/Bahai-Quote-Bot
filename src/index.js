require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3');
const { DateTime } = require('luxon');
const Fuse = require('fuse.js');
const Bluebird = require('bluebird');

// ================== CONFIG ==================
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('\n[ERROR] BOT_TOKEN environment variable not set. Create a .env file with BOT_TOKEN=your_token or export it before running.\n');
  process.exit(1);
}

const COOLDOWN_SEC = process.env.COOLDOWN_SEC ? Number(process.env.COOLDOWN_SEC) : 30;
const DEFAULT_TZ = 'Europe/Chisinau';
const DEFAULT_DAILY_TIME = '09:00';
const DB_PATH = process.env.DB_PATH || 'bot.db';

// ================== DATABASE ==================
const db = new sqlite3.Database(DB_PATH);

function initDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
      chat_id INTEGER PRIMARY KEY,
      timezone TEXT NOT NULL DEFAULT '${DEFAULT_TZ}',
      daily_time TEXT NOT NULL DEFAULT '${DEFAULT_DAILY_TIME}',
      subscribed INTEGER NOT NULL DEFAULT 1,
      last_quote_time INTEGER,
      last_daily_sent TEXT
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS admins (
      chat_id INTEGER PRIMARY KEY
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS broadcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,             -- 'push' | 'weekly'
      schedule TEXT NOT NULL,         -- ISO date for push, 'day|time' for weekly
      message TEXT NOT NULL,
      image TEXT,
      sent INTEGER NOT NULL DEFAULT 0,
      last_sent_date TEXT             -- for weekly to avoid double-sending
    );`);

    // Ensure image column exists if table pre-dated this field
    db.all('PRAGMA table_info(broadcasts)', (err, rows) => {
      if (err) return;
      const hasImage = rows.some((r) => r.name === 'image');
      if (!hasImage) {
        db.run('ALTER TABLE broadcasts ADD COLUMN image TEXT');
      }
    });
  });
}

initDatabase();

// ================== LOAD QUOTES ==================
let quotesCache = [];
function loadQuotes() {
  db.all('SELECT id, text FROM quotes', (err, rows) => {
    if (err) return console.error('Error loading quotes', err);
    quotesCache = rows;
    fuse = new Fuse(quotesCache, {
      keys: ['text'],
      threshold: 0.4,
    });
    console.log(`[INFO] Loaded ${quotesCache.length} quotes.`);
  });
}

let fuse; // initialized when quotes are loaded
loadQuotes();

// ================== BOT INITIALIZATION ==================
const bot = new TelegramBot(TOKEN, { polling: true });
console.log('[INFO] Bot started...');

bot.on('polling_error', tgError);
bot.on('webhook_error', tgError);

// ================ HELPER FUNCTIONS =================
function getRandomQuote() {
  if (!quotesCache.length) return null;
  const idx = Math.floor(Math.random() * quotesCache.length);
  return quotesCache[idx];
}

function getQuoteById(id) {
  return quotesCache.find((q) => q.id === id);
}

function formatQuote(q) {
  return `#${q.id}\n\n${q.text}`;
}

function sendQuote(chatId, quote, opts = {}) {
  return bot
    .sendMessage(chatId, formatQuote(quote), {
      reply_markup: {
        inline_keyboard: [[{ text: '🔄 Ещё', callback_data: 'more' }]],
      },
      ...opts,
    })
    .catch(tgError);
}

function isValidTime(str) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(str);
}

function isAdmin(chatId, cb) {
  db.get('SELECT 1 FROM admins WHERE chat_id = ?', [chatId], (err, row) => {
    if (err) return cb(err, false);
    cb(null, !!row);
  });
}

function scheduleLoop() {
  const nowUtc = DateTime.utc();
  // Daily quotes
  db.all('SELECT chat_id, timezone, daily_time, subscribed, last_daily_sent FROM users WHERE subscribed = 1', (err, rows) => {
    if (err) return console.error(err);
    rows.forEach((u) => {
      const userNow = nowUtc.setZone(u.timezone);
      const timeNow = userNow.toFormat('HH:mm');
      if (timeNow === u.daily_time) {
        const today = userNow.toISODate();
        if (u.last_daily_sent !== today) {
          const q = getRandomQuote();
          if (!q) return;
          sendQuote(u.chat_id, q).catch(tgError);
          db.run('UPDATE users SET last_daily_sent = ? WHERE chat_id = ?', [today, u.chat_id]);
        }
      }
    });
  });

  // One-time broadcasts
  db.all("SELECT * FROM broadcasts WHERE type = 'push' AND sent = 0", (err, rows) => {
    if (err) return console.error(err);
    rows.forEach((b) => {
      const due = DateTime.fromISO(b.schedule, { zone: 'utc' });
      if (due <= nowUtc) {
        broadcastToAll(b.message, b.image);
        db.run('UPDATE broadcasts SET sent = 1 WHERE id = ?', [b.id]);
      }
    });
  });

  // Weekly broadcasts
  db.all("SELECT * FROM broadcasts WHERE type = 'weekly'", (err, rows) => {
    if (err) return console.error(err);
    rows.forEach((b) => {
      const [dayStr, timeStr] = b.schedule.split('|');
      const day = Number(dayStr); // 1-7 ISO weekday
      const nowDay = nowUtc.weekday;
      const nowTime = nowUtc.toFormat('HH:mm');
      if (day === nowDay && timeStr === nowTime) {
        const today = nowUtc.toISODate();
        if (b.last_sent_date !== today) {
          broadcastToAll(b.message, b.image);
          db.run('UPDATE broadcasts SET last_sent_date = ? WHERE id = ?', [today, b.id]);
        }
      }
    });
  });
}

function broadcastToAll(text, image=null) {
  db.all('SELECT chat_id FROM users WHERE subscribed = 1', (err, rows) => {
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

// Run scheduler every minute at second 0
setInterval(scheduleLoop, 60 * 1000);

// ================== COMMAND HANDLERS ==================

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  db.run(
    `INSERT INTO users (chat_id, timezone, daily_time, subscribed)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(chat_id) DO UPDATE SET subscribed = 1`,
    [chatId, DEFAULT_TZ, DEFAULT_DAILY_TIME],
    (err) => {
      if (err) return console.error(err);
      bot.sendMessage(
        chatId,
        `Вы подписаны! Ежедневная цитата будет приходить в ${DEFAULT_DAILY_TIME} (${DEFAULT_TZ}).\nИспользуйте /time, /tz или /randomtime для настройки.`
      );
    }
  );
});

bot.onText(/\/stop/, (msg) => {
  const chatId = msg.chat.id;
  db.run('UPDATE users SET subscribed = 0 WHERE chat_id = ?', [chatId], (err) => {
    if (err) return console.error(err);
    bot.sendMessage(chatId, 'Вы отписаны от ежедневных цитат. Возвращайтесь с /start.');
  });
});

bot.onText(/\/quote(?:\s+(\d+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const requestedId = match[1] ? Number(match[1]) : null;

  db.get('SELECT last_quote_time FROM users WHERE chat_id = ?', [chatId], (err, row) => {
    const now = Date.now();
    if (row && row.last_quote_time && now - row.last_quote_time < COOLDOWN_SEC * 1000) {
      const waitSec = Math.ceil((COOLDOWN_SEC * 1000 - (now - row.last_quote_time)) / 1000);
      return bot.sendMessage(chatId, `Подожди ${waitSec} с перед следующей цитатой.`);
    }

    let q;
    if (requestedId) {
      q = getQuoteById(requestedId);
      if (!q) return bot.sendMessage(chatId, 'Нет цитаты с таким номером.');
    } else {
      q = getRandomQuote();
    }
    if (!q) return bot.sendMessage(chatId, 'База цитат пуста.');

    sendQuote(chatId, q);
    db.run('UPDATE users SET last_quote_time = ? WHERE chat_id = ?', [now, chatId]);
  });
});

bot.onText(/\/time\s+(\d{2}:\d{2})/, (msg, match) => {
  const chatId = msg.chat.id;
  const timeStr = match[1];
  if (!isValidTime(timeStr)) return bot.sendMessage(chatId, 'Неверный формат времени. Пример: /time 08:30');
  db.run('UPDATE users SET daily_time = ? WHERE chat_id = ?', [timeStr, chatId], (err) => {
    if (err) return console.error(err);
    bot.sendMessage(chatId, `Время ежедневной цитаты изменено на ${timeStr}.`);
  });
});

bot.onText(/\/randomtime/, (msg) => {
  const chatId = msg.chat.id;
  const h = Math.floor(Math.random() * 24)
    .toString()
    .padStart(2, '0');
  const m = Math.floor(Math.random() * 60)
    .toString()
    .padStart(2, '0');
  const randomT = `${h}:${m}`;
  db.run('UPDATE users SET daily_time = ? WHERE chat_id = ?', [randomT, chatId], (err) => {
    if (err) return console.error(err);
    bot.sendMessage(chatId, `Случайное время установлено: ${randomT}.`);
  });
});

bot.onText(/\/tz\s+([\w/]+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const tz = match[1];
  if (!DateTime.now().setZone(tz).isValid) return bot.sendMessage(chatId, 'Неверный таймзон. Пример: Europe/Chisinau');
  db.run('UPDATE users SET timezone = ? WHERE chat_id = ?', [tz, chatId], (err) => {
    if (err) return console.error(err);
    bot.sendMessage(chatId, `Часовой пояс обновлён: ${tz}.`);
  });
});

bot.onText(/\/find\s+(.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const query = match[1];
  if (!query.trim()) return bot.sendMessage(chatId, 'Введите текст для поиска.');
  const results = fuse.search(query, { limit: 5 });
  if (!results.length) return bot.sendMessage(chatId, 'Ничего не найдено.');
  const text = results
    .map((r) => formatQuote(r.item))
    .join('\n\n---\n\n');
  bot.sendMessage(chatId, text, { disable_web_page_preview: true });
});

bot.onText(/\/count/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `Всего цитат: ${quotesCache.length}`);
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  const userHelp = `/start – подписаться\n/stop – отписаться\n/quote [N] – случайная или конкретная цитата\n/time HH:MM – установить время\n/randomtime – случайное время\n/tz Area/City – сменить таймзону\n/find слово – поиск цитат\n/count – количество цитат\n/help – эта справка`;

  isAdmin(chatId, (err, ok) => {
    if (err) {
      bot.sendMessage(chatId, userHelp).catch(tgError);
      return;
    }

    let text = userHelp;
    if (ok) {
      text += `\n\n— Админ —\n/push YYYY-MM-DD HH:MM текст – разовая рассылка\n/weekly <1-7> HH:MM текст – еженедельная рассылка\n/blist [N] – список последних N (по умолч. 20) рассылок\n/bdel ID – удалить рассылку\n/bedit ID текст – изменить текст`;
    }

    bot.sendMessage(chatId, text).catch(tgError);
  });
});

// ---------------- ADMIN COMMANDS ----------------

// /pushnow удалена; используйте /push <сообщение> для немедленной рассылки

bot.onText(/\/push\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+([\s\S]+)/, (msg, match) => {
  const chatId = msg.chat.id;
  isAdmin(chatId, (err, ok) => {
    if (err || !ok) return;
    const dateStr = match[1];
    const timeStr = match[2];
    const raw = match[3].trim();
    const [text, img] = raw.split('||').map((s) => s.trim());
    db.get('SELECT timezone FROM users WHERE chat_id = ?', [chatId], (tzErr, row) => {
      const zone = (row && row.timezone) || DEFAULT_TZ;
      const localDt = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone });
      if (!localDt.isValid) {
        return bot.sendMessage(chatId, 'Неверная дата/время.').catch(tgError);
      }
      const iso = localDt.toUTC().toISO();
      db.run('INSERT INTO broadcasts(type, schedule, message, image) VALUES ("push", ?, ?, ?)', [iso, text, img || null]);
      bot
        .sendMessage(chatId, `Разовая рассылка запланирована на ${localDt.toFormat('yyyy-LL-dd HH:mm')} (${zone}).`)
        .catch(tgError);
    });
  });
});

// Variant: only time HH:MM (today or tomorrow)
bot.onText(/\/push\s+(\d{2}:\d{2})\s+([\s\S]+)/, (msg, match) => {
  const chatId = msg.chat.id;
  isAdmin(chatId, (err, ok) => {
    if (err || !ok) return;
    const timeStr = match[1];
    const raw = match[2].trim();
    const [text, img] = raw.split('||').map((s) => s.trim());

    db.get('SELECT timezone FROM users WHERE chat_id = ?', [chatId], (tzErr, row) => {
      const zone = (row && row.timezone) || DEFAULT_TZ;
      const today = DateTime.now().setZone(zone).toFormat('yyyy-LL-dd');
      let localDt = DateTime.fromISO(`${today}T${timeStr}`, { zone });
      if (!localDt.isValid) {
        return bot.sendMessage(chatId, 'Неверная дата/время.').catch(tgError);
      }
      if (localDt <= DateTime.now().setZone(zone)) {
        localDt = localDt.plus({ days: 1 });
      }
      const iso = localDt.toUTC().toISO();
      db.run('INSERT INTO broadcasts(type, schedule, message, image) VALUES ("push", ?, ?, ?)', [iso, text, img || null]);
      bot
        .sendMessage(chatId, `Разовая рассылка запланирована на ${localDt.toFormat('yyyy-LL-dd HH:mm')} (${zone}).`)
        .catch(tgError);
    });
  });
});

bot.onText(/^\/push\s+(?!\d{2}:\d{2}\b)(?!\d{4}-\d{2}-\d{2}\b)([\s\S]+)/, (msg, match) => {
  const chatId = msg.chat.id;
  isAdmin(chatId, (err, ok) => {
    if (err || !ok) return;
    const raw = match[1].trim();
    const [text, img] = raw.split('||').map((s) => s.trim());
    if (!text) return;
    broadcastToAll(text, img);
    const nowIso = DateTime.utc().toISO();
    db.run('INSERT INTO broadcasts(type, schedule, message, image, sent) VALUES ("push", ?, ?, ?, 1)', [nowIso, text, img || null]);
    bot.sendMessage(chatId, 'Немедленная рассылка отправлена.').catch(tgError);
  });
});

// Variant: only time HH:MM (uses текущий день недели админа)
bot.onText(/\/weekly\s+(\d{2}:\d{2})\s+([\s\S]+)/, (msg, match) => {
  const chatId = msg.chat.id;
  isAdmin(chatId, (err, ok) => {
    if (err || !ok) return;
    const timeStr = match[1];
    const raw = match[2].trim();
    const [text, img] = raw.split('||').map((s) => s.trim());
    db.get('SELECT timezone FROM users WHERE chat_id = ?', [chatId], (tzErr, row) => {
      const zone = (row && row.timezone) || DEFAULT_TZ;
      const weekday = DateTime.now().setZone(zone).weekday; // 1-7 ISO
      const scheduleStr = `${weekday}|${timeStr}`;
      db.run('INSERT INTO broadcasts(type, schedule, message, image) VALUES ("weekly", ?, ?, ?)', [scheduleStr, text, img || null]);
      bot
        .sendMessage(chatId, `Weekly рассылка создана: день ${weekday}, время ${timeStr}.`)
        .catch(tgError);
    });
  });
});

// Add full day+time weekly after flexible
bot.onText(/\/weekly\s+(\d)\s+(\d{2}:\d{2})\s+([\s\S]+)/, (msg, match) => {
  const chatId = msg.chat.id;
  isAdmin(chatId, (err, ok) => {
    if (err || !ok) return;
    const day = match[1];
    const timeStr = match[2];
    const raw = match[3].trim();
    const [text, img] = raw.split('||').map((s) => s.trim());
    const scheduleStr = `${day}|${timeStr}`;
    db.run('INSERT INTO broadcasts(type, schedule, message, image) VALUES ("weekly", ?, ?, ?)', [scheduleStr, text, img || null]);
    bot.sendMessage(chatId, 'Еженедельная рассылка сохранена.').catch(tgError);
  });
});

// List broadcasts
bot.onText(/\/blist(?:\s+(\d+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  isAdmin(chatId, (err, ok) => {
    if (err || !ok) return;
    const limit = match[1] ? Math.min(Number(match[1]), 100) : 20;
    db.all('SELECT id, type, schedule, sent, message FROM broadcasts ORDER BY id DESC LIMIT ?', [limit], (e, rows) => {
      if (e) return tgError(e);
      if (!rows.length) return bot.sendMessage(chatId, 'Рассылок нет.').catch(tgError);
      const text = rows
        .map((b) => {
          const mark = b.sent ? '✅' : b.type === 'weekly' ? '🔄' : '⏰';
          return `${mark} #${b.id} [${b.type}] ${b.schedule} – ${b.message.slice(0, 60)}…`;
        })
        .join('\n');
      bot.sendMessage(chatId, text).catch(tgError);
    });
  });
});

// Delete broadcast
bot.onText(/\/bdel\s+(\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const id = Number(match[1]);
  isAdmin(chatId, (err, ok) => {
    if (err || !ok) return;
    db.run('DELETE FROM broadcasts WHERE id = ?', [id], function (e) {
      if (e) return tgError(e);
      const affected = this.changes;
      bot
        .sendMessage(chatId, affected ? `Удалено (${id}).` : `Нет рассылки с id ${id}.`)
        .catch(tgError);
    });
  });
});

// Edit broadcast message
bot.onText(/\/bedit\s+(\d+)\s+([\s\S]+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const id = Number(match[1]);
  const newMsg = match[2].trim();
  isAdmin(chatId, (err, ok) => {
    if (err || !ok) return;
    db.run('UPDATE broadcasts SET message = ? WHERE id = ?', [newMsg, id], function (e) {
      if (e) return tgError(e);
      bot
        .sendMessage(chatId, this.changes ? 'Сообщение обновлено.' : `Нет рассылки с id ${id}.`)
        .catch(tgError);
    });
  });
});

// Inline button handler
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  if (query.data === 'more') {
    const q = getRandomQuote();
    if (q) sendQuote(chatId, q);
  }
  bot.answerCallbackQuery(query.id).catch(tgError);
});

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

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  bot.stopPolling();
  db.close();
  process.exit(0);
}); 