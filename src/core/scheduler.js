const { DateTime } = require('luxon');
const { gptGenerate } = require('../bot/gpt'); // ИЗМЕНЕНО
const { DEFAULT_TZ } = require('./db'); // ИЗМЕНЕНО (пока так, потом db.js тоже переедет)

async function startScheduler(db, bot, getRandomQuote, broadcastToAll) {
  async function handleBroadcast(b) {
    let text = b.message;
    if (b.use_gpt) {
      try {
        text = await gptGenerate(b.gpt_prompt || 'Сгенерируй вдохновляющий пост для Telegram на основе цитат Баха\'и (до 400 символов)');
      } catch (e) {
        console.error('[SCHEDULER] GPT error:', e);
      }
    }
    broadcastToAll(text, b.image);
  }

  async function scheduleLoop() {
    const nowUtc = DateTime.utc();

    // Daily quotes
    db.all('SELECT chat_id, timezone, daily_time, last_daily_sent FROM users WHERE daily_enabled = 1', (err, rows) => {
      if (err) return console.error(err);
      rows.forEach((u) => {
        const userNow = nowUtc.setZone(u.timezone);
        const timeNow = userNow.toFormat('HH:mm');
        if (timeNow === u.daily_time) {
          const today = userNow.toISODate();
          if (u.last_daily_sent !== today) {
            const q = getRandomQuote();
            if (!q) return;
            bot
              .sendMessage(u.chat_id, `#${q.id}\n\n${q.text}`, {
                reply_markup: {
                  inline_keyboard: [[{ text: '🔄 Ещё', callback_data: 'more' }]],
                },
              })
              .catch((e) => console.error(e));
            db.run('UPDATE users SET last_daily_sent = ? WHERE chat_id = ?', [today, u.chat_id]);
          }
        }
      });
    });

    // One-time broadcasts
    db.all("SELECT * FROM broadcasts WHERE type = 'push' AND sent = 0", (err, rows) => {
      if (err) return console.error(err);
      rows.forEach(async (b) => {
        const due = DateTime.fromISO(b.schedule, { zone: 'utc' });
        if (due <= nowUtc) {
          await handleBroadcast(b);
          db.run('UPDATE broadcasts SET sent = 1 WHERE id = ?', [b.id]);
        }
      });
    });

    // Weekly broadcasts
    db.all("SELECT * FROM broadcasts WHERE type = 'weekly'", (err, rows) => {
      if (err) return console.error(err);
      rows.forEach(async (b) => {
        const [dayStr, timeStr] = b.schedule.split('|');
        const day = Number(dayStr); // 1-7 ISO weekday
        const nowDay = nowUtc.weekday;
        const nowTime = nowUtc.toFormat('HH:mm');
        if (day === nowDay && timeStr === nowTime) {
          const today = nowUtc.toISODate();
          if (b.last_sent_date !== today) {
            await handleBroadcast(b);
            db.run('UPDATE broadcasts SET last_sent_date = ? WHERE id = ?', [today, b.id]);
          }
        }
      });
    });

    // Daily broadcasts (admin time in DEFAULT_TZ)
    db.all("SELECT * FROM broadcasts WHERE type = 'daily'", (err, rows) => {
      if (err) return console.error(err);
      const nowLocal = nowUtc.setZone(DEFAULT_TZ);
      const nowTime = nowLocal.toFormat('HH:mm');
      const todayLocal = nowLocal.toISODate();
      rows.forEach(async (b) => {
        if (b.schedule?.trim().slice(0,5) === nowTime) {
          if (b.last_sent_date !== todayLocal) {
            await handleBroadcast(b);
            db.run('UPDATE broadcasts SET last_sent_date = ? WHERE id = ?', [todayLocal, b.id]);
          }
        }
      });
    });
  }

  // Run immediately and then every minute
  scheduleLoop();
  setInterval(scheduleLoop, 60 * 1000);
}

module.exports = { startScheduler }; 