// Адаптер для тестирования favorites модуля
class FavoritesAdapter {
  
  // Добавить цитату в избранное
  async addToFavorites(db, chatId, quoteId) {
    try {
      // Валидация входных данных
      if (!chatId || !quoteId) {
        return false;
      }

      // Проверяем что цитата существует
      const quote = await db.get('SELECT id FROM quotes WHERE id = ?', [quoteId]);
      if (!quote) {
        return false;
      }

      const now = new Date().toISOString();
      const result = await db.run(
        'INSERT OR IGNORE INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
        [chatId, quoteId, now]
      );
      
      return result.changes > 0;
    } catch (error) {
      console.error('Error adding to favorites:', error);
      return false;
    }
  }

  // Удалить цитату из избранного
  async removeFromFavorites(db, chatId, quoteId) {
    try {
      if (!chatId || !quoteId) {
        return false;
      }

      const result = await db.run(
        'DELETE FROM favorite_quotes WHERE chat_id = ? AND quote_id = ?',
        [chatId, quoteId]
      );
      
      return result.changes > 0;
    } catch (error) {
      console.error('Error removing from favorites:', error);
      return false;
    }
  }

  // Проверить, находится ли цитата в избранном
  async isFavorite(db, chatId, quoteId) {
    try {
      if (!chatId || !quoteId) {
        return false;
      }

      const row = await db.get(
        'SELECT 1 FROM favorite_quotes WHERE chat_id = ? AND quote_id = ?',
        [chatId, quoteId]
      );
      
      return !!row;
    } catch (error) {
      console.error('Error checking favorite:', error);
      return false;
    }
  }

  // Получить все избранные цитаты пользователя
  async getUserFavorites(db, chatId, page = 1, limit = 10) {
    try {
      if (!chatId) {
        return [];
      }

      const offset = (page - 1) * limit;
      
      const rows = await db.all(
        `SELECT f.chat_id, f.quote_id, f.favorited_at, q.text, q.author, q.theme, q.source
         FROM favorite_quotes f 
         JOIN quotes q ON f.quote_id = q.id 
         WHERE f.chat_id = ? 
         ORDER BY f.favorited_at DESC 
         LIMIT ? OFFSET ?`,
        [chatId, limit, offset]
      );
      
      return rows || [];
    } catch (error) {
      console.error('Error getting user favorites:', error);
      return [];
    }
  }

  // Получить случайную избранную цитату
  async getRandomFavorite(db, chatId) {
    try {
      if (!chatId) {
        return null;
      }

      const row = await db.get(
        `SELECT f.quote_id, q.text, q.author, q.theme, q.source
         FROM favorite_quotes f 
         JOIN quotes q ON f.quote_id = q.id 
         WHERE f.chat_id = ? 
         ORDER BY RANDOM() 
         LIMIT 1`,
        [chatId]
      );
      
      return row || null;
    } catch (error) {
      console.error('Error getting random favorite:', error);
      return null;
    }
  }

  // Получить количество избранных цитат пользователя
  async getFavoritesCount(db, chatId) {
    try {
      if (!chatId) {
        return 0;
      }

      const row = await db.get(
        'SELECT COUNT(*) as count FROM favorite_quotes WHERE chat_id = ?',
        [chatId]
      );
      
      return row ? row.count : 0;
    } catch (error) {
      console.error('Error getting favorites count:', error);
      return 0;
    }
  }

  // Переключить состояние избранного (добавить/удалить)
  async toggleFavorite(db, chatId, quoteId) {
    try {
      const isCurrentlyFavorite = await this.isFavorite(db, chatId, quoteId);
      
      if (isCurrentlyFavorite) {
        const success = await this.removeFromFavorites(db, chatId, quoteId);
        return { action: 'removed', success };
      } else {
        const success = await this.addToFavorites(db, chatId, quoteId);
        return { action: 'added', success };
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
      return { action: 'error', success: false };
    }
  }

  // Удалить избранные для несуществующих цитат
  async removeOrphanedFavorites(db) {
    try {
      const result = await db.run(
        `DELETE FROM favorite_quotes 
         WHERE quote_id NOT IN (SELECT id FROM quotes)`
      );
      
      return result.changes;
    } catch (error) {
      console.error('Error removing orphaned favorites:', error);
      return 0;
    }
  }

  // Удалить избранные для несуществующих пользователей
  async removeFavoritesForDeletedUsers(db) {
    try {
      const result = await db.run(
        `DELETE FROM favorite_quotes 
         WHERE chat_id NOT IN (SELECT chat_id FROM users)`
      );
      
      return result.changes;
    } catch (error) {
      console.error('Error removing favorites for deleted users:', error);
      return 0;
    }
  }

  // Получить статистику избранного
  async getFavoritesStatistics(db) {
    try {
      const totalFavorites = await db.get('SELECT COUNT(*) as count FROM favorite_quotes');
      const uniqueUsers = await db.get('SELECT COUNT(DISTINCT chat_id) as count FROM favorite_quotes');
      const uniqueQuotes = await db.get('SELECT COUNT(DISTINCT quote_id) as count FROM favorite_quotes');
      const mostFavorited = await db.get(
        `SELECT quote_id, COUNT(*) as count 
         FROM favorite_quotes 
         GROUP BY quote_id 
         ORDER BY count DESC 
         LIMIT 1`
      );
      
      return {
        totalFavorites: totalFavorites.count,
        uniqueUsers: uniqueUsers.count,
        uniqueQuotes: uniqueQuotes.count,
        mostFavoritedQuoteId: mostFavorited ? mostFavorited.quote_id : null,
        mostFavoritedCount: mostFavorited ? mostFavorited.count : 0
      };
    } catch (error) {
      console.error('Error getting favorites statistics:', error);
      return {
        totalFavorites: 0,
        uniqueUsers: 0,
        uniqueQuotes: 0,
        mostFavoritedQuoteId: null,
        mostFavoritedCount: 0
      };
    }
  }
}

module.exports = new FavoritesAdapter();