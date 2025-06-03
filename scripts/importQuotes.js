// Usage: node scripts/importQuotes.js [path_to_json] [db_path]
// Defaults: quotes.json in project root, bot.db

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const jsonPath = process.argv[2] || path.join(__dirname, '..', 'quotes.json');
const dbPath = process.argv[3] || path.join(__dirname, '..', process.env.DB_PATH || 'bot.db');

if (!fs.existsSync(jsonPath)) {
  console.error(`JSON file not found: ${jsonPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
if (!Array.isArray(data)) {
  console.error('Invalid JSON format: expected array');
  process.exit(1);
}

console.log(`\n[INFO] Importing ${data.length} quotes from ${jsonPath} into ${dbPath}...`);

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Ensure table exists (same schema as in main bot)
  db.run(
    `CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL
    );`
  );

  const stmt = db.prepare('INSERT INTO quotes(text) VALUES (?)');
  let inserted = 0;

  data.forEach((item) => {
    const text = item.text && item.text.trim();
    if (text) {
      stmt.run(text);
      inserted++;
    }
  });

  stmt.finalize((err) => {
    if (err) {
      console.error('Error finalizing statement', err);
      process.exit(1);
    }
    console.log(`[INFO] Successfully inserted ${inserted} quotes.`);
    db.close();
  });
}); 