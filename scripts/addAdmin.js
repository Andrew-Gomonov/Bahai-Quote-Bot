// Usage: node scripts/addAdmin.js <chat_id> [db_path]

const sqlite3 = require('sqlite3');
const path = require('path');

const chatId = process.argv[2];
if (!chatId) {
  console.error('Chat ID required. Usage: node scripts/addAdmin.js <chat_id> [db_path]');
  process.exit(1);
}

const dbPath = process.argv[3] || path.join(__dirname, '..', process.env.DB_PATH || 'bot.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS admins (
      chat_id INTEGER PRIMARY KEY
    );`
  );

  db.run('INSERT OR IGNORE INTO admins(chat_id) VALUES (?)', [chatId], (err) => {
    if (err) {
      console.error('Failed to insert admin:', err.message);
      process.exit(1);
    }
    console.log(`[INFO] Admin ${chatId} added (or already existed) to ${dbPath}`);
    db.close();
  });
}); 