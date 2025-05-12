#!/usr/bin/env node
/*
 * promoteSuper.js
 * Promote existing web admin to "super" role.
 * Usage: node scripts/promoteSuper.js <username>
 */

const sqlite3 = require('sqlite3');
const path = require('path');
const DB_PATH = process.env.DB_PATH || 'bot.db';

const username = process.argv[2];
if (!username) {
  console.error('Usage: node scripts/promoteSuper.js <username>');
  process.exit(1);
}

const db = new sqlite3.Database(DB_PATH);

db.run('UPDATE web_admins SET role = "super" WHERE username = ?', [username], function (err) {
  if (err) {
    console.error('DB error:', err.message);
    process.exit(1);
  }
  if (this.changes === 0) {
    console.error('No such user found');
    process.exit(1);
  }
  console.log(`User "${username}" promoted to super.`);
  process.exit(0);
}); 