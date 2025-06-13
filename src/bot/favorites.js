const { db } = require('../core/db');

/**
 * Добавить цитату в избранное
 */
function addToFavorites(chatId, quoteId) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    db.run(
      'INSERT OR IGNORE INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
      [chatId, quoteId, now],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0); // true если цитата была добавлена, false если уже была в избранном
        }
      }
    );
  });
}

/**
 * Удалить цитату из избранного
 */
function removeFromFavorites(chatId, quoteId) {
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM favorite_quotes WHERE chat_id = ? AND quote_id = ?',
      [chatId, quoteId],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0); // true если цитата была удалена
        }
      }
    );
  });
}

/**
 * Проверить, находится ли цитата в избранном
 */
function isFavorite(chatId, quoteId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT 1 FROM favorite_quotes WHERE chat_id = ? AND quote_id = ?',
      [chatId, quoteId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(!!row);
        }
      }
    );
  });
}

/**
 * Получить все избранные цитаты пользователя
 */
function getFavoriteQuotes(chatId, limit = 10, offset = 0) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT q.id, q.text, f.favorited_at 
       FROM favorite_quotes f 
       JOIN quotes q ON f.quote_id = q.id 
       WHERE f.chat_id = ? 
       ORDER BY f.favorited_at DESC 
       LIMIT ? OFFSET ?`,
      [chatId, limit, offset],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
}

/**
 * Получить количество избранных цитат пользователя
 */
function getFavoriteCount(chatId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT COUNT(*) as count FROM favorite_quotes WHERE chat_id = ?',
      [chatId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count);
        }
      }
    );
  });
}

/**
 * Получить случайную избранную цитату
 */
function getRandomFavorite(chatId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT q.id, q.text 
       FROM favorite_quotes f 
       JOIN quotes q ON f.quote_id = q.id 
       WHERE f.chat_id = ? 
       ORDER BY RANDOM() 
       LIMIT 1`,
      [chatId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

module.exports = {
  addToFavorites,
  removeFromFavorites,
  isFavorite,
  getFavoriteQuotes,
  getFavoriteCount,
  getRandomFavorite
}; 