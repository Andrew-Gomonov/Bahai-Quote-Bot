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
      chat_id INTEGER PRIMARY KEY,
      notifications_enabled INTEGER NOT NULL DEFAULT 1
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

    // Новые таблицы для статистики и мотивации
    db.run(`CREATE TABLE IF NOT EXISTS user_achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      achievement_type TEXT NOT NULL,
      achievement_name TEXT NOT NULL,
      achieved_at TEXT NOT NULL,
      value INTEGER DEFAULT 0,
      FOREIGN KEY (chat_id) REFERENCES users (chat_id)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS quote_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      quote_id INTEGER NOT NULL,
      read_at TEXT NOT NULL,
      read_type TEXT NOT NULL DEFAULT 'manual', -- 'manual', 'daily', 'random'
      FOREIGN KEY (chat_id) REFERENCES users (chat_id),
      FOREIGN KEY (quote_id) REFERENCES quotes (id)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS favorite_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      quote_id INTEGER NOT NULL,
      favorited_at TEXT NOT NULL,
      UNIQUE(chat_id, quote_id),
      FOREIGN KEY (chat_id) REFERENCES users (chat_id),
      FOREIGN KEY (quote_id) REFERENCES quotes (id)
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
      const hasNotificationsEnabled = rows.some(r=>r.name==='notifications_enabled');
      
      if (hasUsername && hasPassword) {
        db.all('SELECT username, password FROM admins WHERE username IS NOT NULL', (e2, oldRows) => {
          if (e2) return;
          oldRows.forEach(r => {
            db.run('INSERT OR IGNORE INTO web_admins(username, password) VALUES (?, ?)', [r.username, r.password]);
          });
        });
      }
      
      // Добавляем поле notifications_enabled для существующих админов
      if (!hasNotificationsEnabled) {
        db.run('ALTER TABLE admins ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1');
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
      const hasProfilePicture = rows.some(r => r.name === 'profile_picture');
      if (!hasProfilePicture) {
        db.run('ALTER TABLE web_admins ADD COLUMN profile_picture TEXT');
      }
    });

    // Добавляем новые поля для статистики в таблицу users
    db.all('PRAGMA table_info(users)', (err, rows) => {
      if (err) return;
      const hasDailyEnabled = rows.some((r) => r.name === 'daily_enabled');
      const hasBroadcastEnabled = rows.some((r) => r.name === 'broadcast_enabled');
      const hasJoinedAt = rows.some((r) => r.name === 'joined_at');
      const hasQuotesRead = rows.some((r) => r.name === 'quotes_read_total');
      const hasDailyStreak = rows.some((r) => r.name === 'daily_streak');
      const hasLastActiveAt = rows.some((r) => r.name === 'last_active_at');
      const hasLevel = rows.some((r) => r.name === 'level');
      const hasExperience = rows.some((r) => r.name === 'experience');

      if (!hasDailyEnabled) {
        db.run('ALTER TABLE users ADD COLUMN daily_enabled INTEGER NOT NULL DEFAULT 1');
      }
      if (!hasBroadcastEnabled) {
        db.run('ALTER TABLE users ADD COLUMN broadcast_enabled INTEGER NOT NULL DEFAULT 1');
      }
      if (!hasJoinedAt) {
        db.run("ALTER TABLE users ADD COLUMN joined_at TEXT DEFAULT ''", () => {
          // Устанавливаем дату регистрации для существующих пользователей
          const now = new Date().toISOString();
          db.run('UPDATE users SET joined_at = ? WHERE joined_at IS NULL OR joined_at = ""', [now]);
        });
      }
      if (!hasQuotesRead) {
        db.run('ALTER TABLE users ADD COLUMN quotes_read_total INTEGER NOT NULL DEFAULT 0');
      }
      if (!hasDailyStreak) {
        db.run('ALTER TABLE users ADD COLUMN daily_streak INTEGER NOT NULL DEFAULT 0');
      }
      if (!hasLastActiveAt) {
        db.run('ALTER TABLE users ADD COLUMN last_active_at TEXT');
      }
      if (!hasLevel) {
        db.run('ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1');
      }
      if (!hasExperience) {
        db.run('ALTER TABLE users ADD COLUMN experience INTEGER NOT NULL DEFAULT 0');
      }
    });

    // Таблица для хранения ИИ объяснений цитат
    db.run(`CREATE TABLE IF NOT EXISTS quote_explanations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL,
      explanation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(quote_id),
      FOREIGN KEY (quote_id) REFERENCES quotes (id)
    );`);

    // Таблица для хранения статуса функции ИИ объяснений
    db.run(`CREATE TABLE IF NOT EXISTS ai_explainer_status (
      id INTEGER PRIMARY KEY DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      disabled_at TEXT,
      enabled_at TEXT,
      disable_reason TEXT
    );`);

    // Добавляем новые поля для поиска в таблицу quotes
    db.all('PRAGMA table_info(quotes)', (err, rows) => {
      if (err) return;
      const hasAuthor = rows.some((r) => r.name === 'author');
      const hasTheme = rows.some((r) => r.name === 'theme');
      const hasSource = rows.some((r) => r.name === 'source');

      if (!hasAuthor) {
        db.run('ALTER TABLE quotes ADD COLUMN author TEXT');
      }
      if (!hasTheme) {
        db.run('ALTER TABLE quotes ADD COLUMN theme TEXT');
      }
      if (!hasSource) {
        db.run('ALTER TABLE quotes ADD COLUMN source TEXT');
      }
    });
  });
}

module.exports = { db, initDatabase, DEFAULT_TZ, DEFAULT_DAILY_TIME }; 