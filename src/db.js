const sqlite3 = require('sqlite3');

// Путь к файлу бд тот же, что и в главном файле
const DB_PATH = process.env.DB_PATH || 'bot.db';
const DEFAULT_TZ = 'Europe/Chisinau';
const DEFAULT_DAILY_TIME = '09:00';

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
      daily_enabled INTEGER NOT NULL DEFAULT 1,
      broadcast_enabled INTEGER NOT NULL DEFAULT 1,
      last_quote_time INTEGER,
      last_daily_sent TEXT
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS admins (
      chat_id INTEGER PRIMARY KEY
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS web_admins (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin'
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS broadcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,             -- 'push' | 'weekly'
      schedule TEXT NOT NULL,         -- ISO date for push, 'day|time' for weekly
      message TEXT NOT NULL,
      image TEXT,
      use_gpt INTEGER NOT NULL DEFAULT 0,
      gpt_prompt TEXT,
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
      const hasUseGpt = rows.some((r) => r.name === 'use_gpt');
      if (!hasUseGpt) {
        db.run('ALTER TABLE broadcasts ADD COLUMN use_gpt INTEGER NOT NULL DEFAULT 0');
      }
      const hasGptPrompt = rows.some((r) => r.name === 'gpt_prompt');
      if (!hasGptPrompt) {
        db.run('ALTER TABLE broadcasts ADD COLUMN gpt_prompt TEXT');
      }
    });

    // Миграция старой схемы (username/password в admins) -> web_admins
    db.all('PRAGMA table_info(admins)', (err, rows) => {
      if (err) return;
      const hasUsername = rows.some(r=>r.name==='username');
      const hasPassword = rows.some(r=>r.name==='password');
      if (hasUsername && hasPassword) {
        db.all('SELECT username, password FROM admins WHERE username IS NOT NULL', (e2, oldRows) => {
          if (e2) return;
          oldRows.forEach(r => {
            db.run('INSERT OR IGNORE INTO web_admins(username, password) VALUES (?, ?)', [r.username, r.password]);
          });
        });
      }
    });

    db.all('PRAGMA table_info(web_admins)', (err, rows) => {
      if (err) return;
      const hasRole = rows.some(r=>r.name==='role');
      if (!hasRole) {
        db.run("ALTER TABLE web_admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'", () => {
          // elevate env ADMIN_USER to super
          const superUser = process.env.ADMIN_USER || 'admin';
          db.run('UPDATE web_admins SET role = "super" WHERE username = ?', [superUser]);
        });
      }
    });

    db.all('PRAGMA table_info(users)', (err, rows) => {
      if (err) return;
      const hasDailyEnabled = rows.some((r) => r.name === 'daily_enabled');
      const hasBroadcastEnabled = rows.some((r) => r.name === 'broadcast_enabled');
      if (!hasDailyEnabled) {
        db.run('ALTER TABLE users ADD COLUMN daily_enabled INTEGER NOT NULL DEFAULT 1');
      }
      if (!hasBroadcastEnabled) {
        db.run('ALTER TABLE users ADD COLUMN broadcast_enabled INTEGER NOT NULL DEFAULT 1');
      }
    });
  });
}

module.exports = { db, initDatabase, DEFAULT_TZ, DEFAULT_DAILY_TIME }; 