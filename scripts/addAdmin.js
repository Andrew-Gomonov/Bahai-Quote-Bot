// Usage: node scripts/addAdmin.js <chat_id> [db_path]
//        node scripts/addAdmin.js --web <username> <password> [db_path]

const sqlite3 = require('sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const arg1 = process.argv[2];

const isWeb = arg1 === '--web';

if (isWeb) {
  const username = process.argv[3];
  const plainPass = process.argv[4];
  if (!username || !plainPass) {
    console.error('Usage: node scripts/addAdmin.js --web <username> <password> [db_path]');
    process.exit(1);
  }

  const dbPath = process.argv[5] || path.join(__dirname, '..', process.env.DB_PATH || 'bot.db');
  const db = new sqlite3.Database(dbPath);

  const saltRounds = 10;
  bcrypt.hash(plainPass, saltRounds, (err, hash) => {
    if (err) {
      console.error('Error hashing password:', err.message);
      process.exit(1);
    }

    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS web_admins (username TEXT PRIMARY KEY, password TEXT NOT NULL);`);

      db.run('INSERT OR REPLACE INTO web_admins(username, password) VALUES (?, ?)', [username, hash], (e) => {
        if (e) {
          console.error('Failed to insert web admin:', e.message);
          process.exit(1);
        }
        console.log(`[INFO] Web admin '${username}' added/updated in ${dbPath}`);
        db.close();
      });
    });
  });
  return;
}

// === Telegram admin path ===

const chatId = arg1;
if (!chatId) {
  console.error('Chat ID required. Usage: node scripts/addAdmin.js <chat_id> [db_path]');
  process.exit(1);
}

const dbPath = process.argv[3] || path.join(__dirname, '..', process.env.DB_PATH || 'bot.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS admins (
      chat_id INTEGER PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT
    );`
  );

  db.run('INSERT OR IGNORE INTO admins(chat_id) VALUES (?)', [chatId], (err) => {
    if (err) {
      console.error('Failed to insert admin:', err.message);
      process.exit(1);
    }
    console.log(`[INFO] Telegram admin ${chatId} added (or already existed) to ${dbPath}`);
    db.close();
  });
}); 