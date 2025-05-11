const { DateTime } = require('luxon');

function startScheduler(db, bot, getRandomQuote, broadcastToAll) {
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

  // Run immediately and then every minute
  scheduleLoop();
  setInterval(scheduleLoop, 60 * 1000);
}

module.exports = { startScheduler }; 