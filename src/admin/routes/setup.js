const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const envPath = path.join(__dirname, '..', '..', '.env');

router.get('/setup', (req, res) => {
  if (process.env.BOT_TOKEN) return res.redirect('/login');
  res.render('setup', { title: 'Initial Setup', error: null });
});

router.post('/setup', (req, res) => {
  if (process.env.BOT_TOKEN) return res.redirect('/login');
  const { bot_token, db_path, admin_user, admin_pass, openai_key, openai_model, openai_max_tokens } = req.body;
  if (!bot_token || !admin_user || !admin_pass) {
    return res.render('setup', { title: 'Initial Setup', error: 'BOT_TOKEN, admin username and password are required.' });
  }

  const lines = [
    `BOT_TOKEN=${bot_token}`,
    `DB_PATH=${db_path || 'bot.db'}`
  ];
  if (openai_key) lines.push(`OPENAI_API_KEY=${openai_key}`);
  if (openai_model) lines.push(`OPENAI_MODEL=${openai_model}`);
  if (openai_max_tokens) lines.push(`OPENAI_MAX_TOKENS=${openai_max_tokens}`);
  fs.writeFileSync(envPath, lines.join('\n'));

  process.env.BOT_TOKEN = bot_token;
  process.env.DB_PATH = db_path || 'bot.db';
  if (openai_key) process.env.OPENAI_API_KEY = openai_key;
  if (openai_model) process.env.OPENAI_MODEL = openai_model;
  if (openai_max_tokens) process.env.OPENAI_MAX_TOKENS = openai_max_tokens;

  const { db, initDatabase } = require('../../core/db');
  initDatabase();

  bcrypt.hash(admin_pass, 10, (err, hash) => {
    if (err) return res.status(500).send(err.message);
    db.run('INSERT OR REPLACE INTO web_admins(username, password, role) VALUES (?, ?, ?)', [admin_user, hash, 'super'], (e) => {
      if (e) return res.status(500).send(e.message);
      res.redirect('/login');
    });
  });
});

module.exports = router;
