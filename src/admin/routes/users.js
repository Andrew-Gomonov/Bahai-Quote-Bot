const express = require('express');
const router = express.Router();

const { db: sharedDb, DEFAULT_TZ, DEFAULT_DAILY_TIME } = require('../../core/db');

function db() { return sharedDb; }

// List users
router.get('/', (req, res) => {
  const d = db();
  d.all('SELECT * FROM users ORDER BY chat_id LIMIT 1000', (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.render('users', { title: 'Пользователи', rows, DEFAULT_TZ, DEFAULT_DAILY_TIME });
  });
});

// Add user manually
router.post('/', (req, res) => {
  const chatId = Number(req.body.chat_id);
  const tz = req.body.timezone || DEFAULT_TZ;
  const time = req.body.daily_time || DEFAULT_DAILY_TIME;
  if (!chatId) return res.redirect('/users');
  const d = db();
  d.run('INSERT OR IGNORE INTO users(chat_id, timezone, daily_time) VALUES (?, ?, ?)', [chatId, tz, time], () => {
    res.redirect('/users');
  });
});

// Update user
router.post('/update/:id', (req, res) => {
  const id = Number(req.params.id);
  const { timezone, daily_time, subscribed } = req.body;
  const sub = subscribed ? 1 : 0;
  const d = db();
  d.run('UPDATE users SET timezone = ?, daily_time = ?, subscribed = ? WHERE chat_id = ?', [timezone, daily_time, sub, id], () => {
    res.redirect('/users');
  });
});

// Delete user
router.post('/delete/:id', (req, res) => {
  const id = Number(req.params.id);
  const d = db();
  d.run('DELETE FROM users WHERE chat_id = ?', [id], () => {
    res.redirect('/users');
  });
});

module.exports = router; 