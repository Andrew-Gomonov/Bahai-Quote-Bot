const { DateTime } = require('luxon');
const { DEFAULT_TZ, DEFAULT_DAILY_TIME } = require('./db');
const {
  getRandomQuote,
  getQuoteById,
  sendQuote,
  searchQuotes,
  formatQuote,
  getQuotesCount,
} = require('./quotes');

function registerCommands(bot, db, broadcastToAll, tgError) {
  // helper
  function isValidTime(str) {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(str);
  }

  function isAdmin(chatId, cb) {
    db.get('SELECT 1 FROM admins WHERE chat_id = ?', [chatId], (err, row) => {
      if (err) return cb(err, false);
      cb(null, !!row);
    });
  }

  // ---------------- USER COMMANDS ----------------
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
      const COOLDOWN_SEC = process.env.COOLDOWN_SEC ? Number(process.env.COOLDOWN_SEC) : 30;
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

      sendQuote(bot, chatId, q);
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
    const results = searchQuotes(query, 5);
    if (!results.length) return bot.sendMessage(chatId, 'Ничего не найдено.');
    const text = results.map((r) => formatQuote(r)).join('\n\n---\n\n');
    bot.sendMessage(chatId, text, { disable_web_page_preview: true });
  });

  bot.onText(/\/count/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `Всего цитат: ${getQuotesCount()}`);
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
  // ... скопированы дальше из index.js (push, weekly, blist, bdel, bedit)

  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    if (query.data === 'more') {
      const q = getRandomQuote();
      if (q) sendQuote(bot, chatId, q);
    }
    bot.answerCallbackQuery(query.id).catch(tgError);
  });
}

module.exports = { registerCommands }; 