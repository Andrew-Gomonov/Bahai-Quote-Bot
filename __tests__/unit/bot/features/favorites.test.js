const { testDb } = require('../../../setup/database-setup');
const favorites = require('../../../setup/mocks/favorites-adapter');

describe('Favorites System', () => {
  let testDatabase;
  const testChatId = 12345;

  beforeEach(async () => {
    testDatabase = await testDb.createTestConnection(`favorites_test_${Date.now()}`);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await testDb.closeConnection(`favorites_test_${Date.now()}`);
  });

  describe('Add to Favorites', () => {
    test('should add quote to favorites successfully', async () => {
      const quoteId = 1;
      
      const result = await favorites.addToFavorites(testDatabase, testChatId, quoteId);
      
      expect(result).toBe(true);
      
      // Проверяем что запись создалась в БД
      const favorite = await testDatabase.get(
        'SELECT * FROM favorite_quotes WHERE chat_id = ? AND quote_id = ?',
        [testChatId, quoteId]
      );
      
      expect(favorite).toBeDefined();
      expect(favorite.chat_id).toBe(testChatId);
      expect(favorite.quote_id).toBe(quoteId);
      expect(favorite.favorited_at).toBeDefined();
    });

    test('should handle duplicate favorite addition', async () => {
      const quoteId = 1;
      
      // Добавляем первый раз
      const result1 = await favorites.addToFavorites(testDatabase, testChatId, quoteId);
      expect(result1).toBe(true);
      
      // Пытаемся добавить повторно
      const result2 = await favorites.addToFavorites(testDatabase, testChatId, quoteId);
      expect(result2).toBe(false); // Уже в избранном
      
      // Проверяем что в БД только одна запись
      const allFavorites = await testDatabase.all(
        'SELECT * FROM favorite_quotes WHERE chat_id = ? AND quote_id = ?',
        [testChatId, quoteId]
      );
      expect(allFavorites.length).toBe(1);
    });

    test('should handle invalid quote ID', async () => {
      const invalidQuoteId = 99999;
      
      const result = await favorites.addToFavorites(testDatabase, testChatId, invalidQuoteId);
      expect(result).toBe(false);
      
      // Проверяем что запись не создалась
      const favorite = await testDatabase.get(
        'SELECT * FROM favorite_quotes WHERE chat_id = ? AND quote_id = ?',
        [testChatId, invalidQuoteId]
      );
      expect(favorite).toBeUndefined();
    });

    test('should handle invalid user ID', async () => {
      const quoteId = 1;
      const invalidChatId = null;
      
      const result = await favorites.addToFavorites(testDatabase, invalidChatId, quoteId);
      expect(result).toBe(false);
    });

    test('should validate quote exists before adding', async () => {
      const quoteId = 1;
      
      // Сначала проверяем что цитата существует
      const quote = await testDatabase.get('SELECT * FROM quotes WHERE id = ?', [quoteId]);
      expect(quote).toBeDefined();
      
      const result = await favorites.addToFavorites(testDatabase, testChatId, quoteId);
      expect(result).toBe(true);
    });

    test('should handle database errors gracefully', async () => {
      const originalRun = testDatabase.run;
      testDatabase.run = jest.fn().mockRejectedValue(new Error('Database error'));
      
      const result = await favorites.addToFavorites(testDatabase, testChatId, 1);
      expect(result).toBe(false);
      
      testDatabase.run = originalRun;
    });

    test('should set correct timestamp', async () => {
      const quoteId = 1;
      const beforeTime = new Date().toISOString();
      
      await favorites.addToFavorites(testDatabase, testChatId, quoteId);
      
      const afterTime = new Date().toISOString();
      
      const favorite = await testDatabase.get(
        'SELECT * FROM favorite_quotes WHERE chat_id = ? AND quote_id = ?',
        [testChatId, quoteId]
      );
      
      expect(favorite.favorited_at).toBeGreaterThanOrEqual(beforeTime);
      expect(favorite.favorited_at).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('Remove from Favorites', () => {
    beforeEach(async () => {
      // Добавляем тестовую избранную цитату
      await testDatabase.run(
        'INSERT INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
        [testChatId, 1, new Date().toISOString()]
      );
    });

    test('should remove quote from favorites successfully', async () => {
      const quoteId = 1;
      
      const result = await favorites.removeFromFavorites(testDatabase, testChatId, quoteId);
      expect(result).toBe(true);
      
      // Проверяем что запись удалилась
      const favorite = await testDatabase.get(
        'SELECT * FROM favorite_quotes WHERE chat_id = ? AND quote_id = ?',
        [testChatId, quoteId]
      );
      expect(favorite).toBeUndefined();
    });

    test('should handle removing non-existent favorite', async () => {
      const nonExistentQuoteId = 99999;
      
      const result = await favorites.removeFromFavorites(testDatabase, testChatId, nonExistentQuoteId);
      expect(result).toBe(false);
    });

    test('should handle invalid parameters', async () => {
      const result1 = await favorites.removeFromFavorites(testDatabase, null, 1);
      const result2 = await favorites.removeFromFavorites(testDatabase, testChatId, null);
      const result3 = await favorites.removeFromFavorites(testDatabase, undefined, undefined);
      
      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
    });

    test('should handle database errors gracefully', async () => {
      const originalRun = testDatabase.run;
      testDatabase.run = jest.fn().mockRejectedValue(new Error('Database error'));
      
      const result = await favorites.removeFromFavorites(testDatabase, testChatId, 1);
      expect(result).toBe(false);
      
      testDatabase.run = originalRun;
    });

    test('should only remove specific user favorites', async () => {
      const otherChatId = 67890;
      const quoteId = 1;
      
      // Добавляем избранное для другого пользователя
      await testDatabase.run(
        'INSERT INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
        [otherChatId, quoteId, new Date().toISOString()]
      );
      
      // Удаляем избранное первого пользователя
      const result = await favorites.removeFromFavorites(testDatabase, testChatId, quoteId);
      expect(result).toBe(true);
      
      // Проверяем что избранное другого пользователя осталось
      const otherUserFavorite = await testDatabase.get(
        'SELECT * FROM favorite_quotes WHERE chat_id = ? AND quote_id = ?',
        [otherChatId, quoteId]
      );
      expect(otherUserFavorite).toBeDefined();
    });
  });

  describe('Check if Favorite', () => {
    beforeEach(async () => {
      // Добавляем тестовую избранную цитату
      await testDatabase.run(
        'INSERT INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
        [testChatId, 1, new Date().toISOString()]
      );
    });

    test('should return true for favorite quote', async () => {
      const isFavorite = await favorites.isFavorite(testDatabase, testChatId, 1);
      expect(isFavorite).toBe(true);
    });

    test('should return false for non-favorite quote', async () => {
      const isFavorite = await favorites.isFavorite(testDatabase, testChatId, 2);
      expect(isFavorite).toBe(false);
    });

    test('should handle invalid parameters', async () => {
      const result1 = await favorites.isFavorite(testDatabase, null, 1);
      const result2 = await favorites.isFavorite(testDatabase, testChatId, null);
      const result3 = await favorites.isFavorite(testDatabase, undefined, undefined);
      
      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
    });

    test('should handle database errors', async () => {
      const originalGet = testDatabase.get;
      testDatabase.get = jest.fn().mockRejectedValue(new Error('Database error'));
      
      const isFavorite = await favorites.isFavorite(testDatabase, testChatId, 1);
      expect(isFavorite).toBe(false);
      
      testDatabase.get = originalGet;
    });

    test('should be case-sensitive for user IDs', async () => {
      const differentChatId = 54321;
      
      const isFavorite = await favorites.isFavorite(testDatabase, differentChatId, 1);
      expect(isFavorite).toBe(false);
    });
  });

  describe('Get User Favorites', () => {
    beforeEach(async () => {
      // Добавляем несколько избранных цитат
      const testFavorites = [
        { chat_id: testChatId, quote_id: 1, favorited_at: new Date(Date.now() - 3600000).toISOString() },
        { chat_id: testChatId, quote_id: 2, favorited_at: new Date(Date.now() - 1800000).toISOString() },
        { chat_id: testChatId, quote_id: 3, favorited_at: new Date().toISOString() }
      ];
      
      for (const fav of testFavorites) {
        await testDatabase.run(
          'INSERT INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
          [fav.chat_id, fav.quote_id, fav.favorited_at]
        );
      }
    });

    test('should get all user favorites', async () => {
      const userFavorites = await favorites.getUserFavorites(testDatabase, testChatId);
      
      expect(userFavorites).toBeDefined();
      expect(Array.isArray(userFavorites)).toBe(true);
      expect(userFavorites.length).toBe(3);
      
      // Проверяем что все избранные принадлежат пользователю
      userFavorites.forEach(fav => {
        expect(fav.chat_id).toBe(testChatId);
        expect(fav.quote_id).toBeDefined();
        expect(fav.text).toBeDefined(); // Должен включать данные цитаты
        expect(fav.author).toBeDefined();
      });
    });

    test('should return favorites ordered by most recent first', async () => {
      const userFavorites = await favorites.getUserFavorites(testDatabase, testChatId);
      
      expect(userFavorites.length).toBeGreaterThan(1);
      
      // Проверяем сортировку по времени добавления (новые сначала)
      for (let i = 0; i < userFavorites.length - 1; i++) {
        expect(userFavorites[i].favorited_at).toBeGreaterThanOrEqual(userFavorites[i + 1].favorited_at);
      }
    });

    test('should handle pagination', async () => {
      const page1 = await favorites.getUserFavorites(testDatabase, testChatId, 1, 2);
      const page2 = await favorites.getUserFavorites(testDatabase, testChatId, 2, 2);
      
      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);
      
      // Проверяем что страницы не пересекаются
      if (page1.length > 0 && page2.length > 0) {
        const page1Ids = page1.map(f => f.quote_id);
        const page2Ids = page2.map(f => f.quote_id);
        
        const intersection = page1Ids.filter(id => page2Ids.includes(id));
        expect(intersection.length).toBe(0);
      }
    });

    test('should return empty array for user with no favorites', async () => {
      const userWithoutFavorites = 99999;
      
      const userFavorites = await favorites.getUserFavorites(testDatabase, userWithoutFavorites);
      
      expect(userFavorites).toBeDefined();
      expect(Array.isArray(userFavorites)).toBe(true);
      expect(userFavorites.length).toBe(0);
    });

    test('should handle invalid user ID', async () => {
      const userFavorites = await favorites.getUserFavorites(testDatabase, null);
      
      expect(userFavorites).toBeDefined();
      expect(Array.isArray(userFavorites)).toBe(true);
      expect(userFavorites.length).toBe(0);
    });

    test('should include quote details', async () => {
      const userFavorites = await favorites.getUserFavorites(testDatabase, testChatId);
      
      expect(userFavorites.length).toBeGreaterThan(0);
      
      const firstFavorite = userFavorites[0];
      expect(firstFavorite.quote_id).toBeDefined();
      expect(firstFavorite.text).toBeDefined();
      expect(firstFavorite.author).toBeDefined();
      expect(firstFavorite.theme).toBeDefined();
      expect(firstFavorite.source).toBeDefined();
      expect(firstFavorite.favorited_at).toBeDefined();
    });

    test('should handle database errors', async () => {
      const originalAll = testDatabase.all;
      testDatabase.all = jest.fn().mockRejectedValue(new Error('Database error'));
      
      const userFavorites = await favorites.getUserFavorites(testDatabase, testChatId);
      
      expect(userFavorites).toBeDefined();
      expect(Array.isArray(userFavorites)).toBe(true);
      expect(userFavorites.length).toBe(0);
      
      testDatabase.all = originalAll;
    });
  });

  describe('Get Random Favorite', () => {
    beforeEach(async () => {
      // Добавляем несколько избранных
      for (let i = 1; i <= 3; i++) {
        await testDatabase.run(
          'INSERT INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
          [testChatId, i, new Date().toISOString()]
        );
      }
    });

    test('should return random favorite quote', async () => {
      const randomFavorite = await favorites.getRandomFavorite(testDatabase, testChatId);
      
      expect(randomFavorite).toBeDefined();
      expect(randomFavorite.quote_id).toBeDefined();
      expect(randomFavorite.text).toBeDefined();
      expect(randomFavorite.author).toBeDefined();
      expect([1, 2, 3]).toContain(randomFavorite.quote_id);
    });

    test('should return different quotes on multiple calls', async () => {
      const favorites1 = await favorites.getRandomFavorite(testDatabase, testChatId);
      const favorites2 = await favorites.getRandomFavorite(testDatabase, testChatId);
      const favorites3 = await favorites.getRandomFavorite(testDatabase, testChatId);
      
      expect(favorites1).toBeDefined();
      expect(favorites2).toBeDefined();
      expect(favorites3).toBeDefined();
      
      // С 3 цитатами должны получить некоторое разнообразие
      const uniqueIds = new Set([favorites1.quote_id, favorites2.quote_id, favorites3.quote_id]);
      expect(uniqueIds.size).toBeGreaterThan(1);
    });

    test('should return null for user with no favorites', async () => {
      const userWithoutFavorites = 99999;
      
      const randomFavorite = await favorites.getRandomFavorite(testDatabase, userWithoutFavorites);
      expect(randomFavorite).toBeNull();
    });

    test('should handle invalid user ID', async () => {
      const randomFavorite = await favorites.getRandomFavorite(testDatabase, null);
      expect(randomFavorite).toBeNull();
    });

    test('should handle database errors', async () => {
      const originalGet = testDatabase.get;
      testDatabase.get = jest.fn().mockRejectedValue(new Error('Database error'));
      
      const randomFavorite = await favorites.getRandomFavorite(testDatabase, testChatId);
      expect(randomFavorite).toBeNull();
      
      testDatabase.get = originalGet;
    });

    test('should work with single favorite', async () => {
      // Удаляем все кроме одного избранного
      await testDatabase.run(
        'DELETE FROM favorite_quotes WHERE chat_id = ? AND quote_id != 1',
        [testChatId]
      );
      
      const randomFavorite = await favorites.getRandomFavorite(testDatabase, testChatId);
      
      expect(randomFavorite).toBeDefined();
      expect(randomFavorite.quote_id).toBe(1);
    });
  });

  describe('Get Favorites Count', () => {
    beforeEach(async () => {
      // Добавляем избранные для разных пользователей
      const testData = [
        { chat_id: testChatId, quote_id: 1 },
        { chat_id: testChatId, quote_id: 2 },
        { chat_id: testChatId, quote_id: 3 },
        { chat_id: 67890, quote_id: 1 },
        { chat_id: 67890, quote_id: 4 }
      ];
      
      for (const data of testData) {
        await testDatabase.run(
          'INSERT INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
          [data.chat_id, data.quote_id, new Date().toISOString()]
        );
      }
    });

    test('should return correct count for user', async () => {
      const count = await favorites.getFavoritesCount(testDatabase, testChatId);
      expect(count).toBe(3);
      
      const otherUserCount = await favorites.getFavoritesCount(testDatabase, 67890);
      expect(otherUserCount).toBe(2);
    });

    test('should return 0 for user with no favorites', async () => {
      const userWithoutFavorites = 99999;
      const count = await favorites.getFavoritesCount(testDatabase, userWithoutFavorites);
      expect(count).toBe(0);
    });

    test('should handle invalid user ID', async () => {
      const count = await favorites.getFavoritesCount(testDatabase, null);
      expect(count).toBe(0);
    });

    test('should handle database errors', async () => {
      const originalGet = testDatabase.get;
      testDatabase.get = jest.fn().mockRejectedValue(new Error('Database error'));
      
      const count = await favorites.getFavoritesCount(testDatabase, testChatId);
      expect(count).toBe(0);
      
      testDatabase.get = originalGet;
    });

    test('should update count when favorites are added/removed', async () => {
      const initialCount = await favorites.getFavoritesCount(testDatabase, testChatId);
      
      // Добавляем новое избранное
      await favorites.addToFavorites(testDatabase, testChatId, 4);
      const afterAddCount = await favorites.getFavoritesCount(testDatabase, testChatId);
      expect(afterAddCount).toBe(initialCount + 1);
      
      // Удаляем избранное
      await favorites.removeFromFavorites(testDatabase, testChatId, 1);
      const afterRemoveCount = await favorites.getFavoritesCount(testDatabase, testChatId);
      expect(afterRemoveCount).toBe(initialCount);
    });
  });

  describe('Toggle Favorite', () => {
    test('should add quote to favorites if not already favorite', async () => {
      const quoteId = 1;
      
      const result = await favorites.toggleFavorite(testDatabase, testChatId, quoteId);
      
      expect(result.action).toBe('added');
      expect(result.success).toBe(true);
      
      const isFav = await favorites.isFavorite(testDatabase, testChatId, quoteId);
      expect(isFav).toBe(true);
    });

    test('should remove quote from favorites if already favorite', async () => {
      const quoteId = 1;
      
      // Сначала добавляем в избранное
      await favorites.addToFavorites(testDatabase, testChatId, quoteId);
      
      const result = await favorites.toggleFavorite(testDatabase, testChatId, quoteId);
      
      expect(result.action).toBe('removed');
      expect(result.success).toBe(true);
      
      const isFav = await favorites.isFavorite(testDatabase, testChatId, quoteId);
      expect(isFav).toBe(false);
    });

    test('should handle invalid parameters', async () => {
      const result1 = await favorites.toggleFavorite(testDatabase, null, 1);
      const result2 = await favorites.toggleFavorite(testDatabase, testChatId, null);
      
      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
    });

    test('should handle database errors', async () => {
      const originalGet = testDatabase.get;
      testDatabase.get = jest.fn().mockRejectedValue(new Error('Database error'));
      
      const result = await favorites.toggleFavorite(testDatabase, testChatId, 1);
      expect(result.success).toBe(false);
      
      testDatabase.get = originalGet;
    });
  });

  describe('Cleanup and Maintenance', () => {
    test('should remove orphaned favorites when quote is deleted', async () => {
      const quoteId = 999;
      
      // Добавляем тестовую цитату
      await testDatabase.run(
        'INSERT INTO quotes (id, text, author, theme, source) VALUES (?, ?, ?, ?, ?)',
        [quoteId, 'Temporary quote', 'Test Author', 'Test', 'Test']
      );
      
      // Добавляем в избранное
      await favorites.addToFavorites(testDatabase, testChatId, quoteId);
      
      // Удаляем цитату
      await testDatabase.run('DELETE FROM quotes WHERE id = ?', [quoteId]);
      
      // Очищаем сиротские избранные
      await favorites.cleanupOrphanedFavorites(testDatabase);
      
      // Проверяем что избранное тоже удалилось
      const orphanedFavorite = await testDatabase.get(
        'SELECT * FROM favorite_quotes WHERE quote_id = ?', [quoteId]
      );
      expect(orphanedFavorite).toBeUndefined();
    });

    test('should remove favorites for deleted users', async () => {
      const tempChatId = 88888;
      
      // Добавляем пользователя
      await testDb.addTestUser(testDatabase, { chat_id: tempChatId });
      
      // Добавляем избранное
      await favorites.addToFavorites(testDatabase, tempChatId, 1);
      
      // Удаляем пользователя
      await testDatabase.run('DELETE FROM users WHERE chat_id = ?', [tempChatId]);
      
      // Очищаем избранные удаленных пользователей
      await favorites.cleanupDeletedUserFavorites(testDatabase);
      
      // Проверяем что избранные удалились
      const userFavorites = await favorites.getUserFavorites(testDatabase, tempChatId);
      expect(userFavorites.length).toBe(0);
    });

    test('should get favorites statistics', async () => {
      // Добавляем избранные для статистики
      await favorites.addToFavorites(testDatabase, testChatId, 1);
      await favorites.addToFavorites(testDatabase, testChatId, 2);
      await favorites.addToFavorites(testDatabase, 67890, 1);
      
      const stats = await favorites.getFavoritesStatistics(testDatabase);
      
      expect(stats).toBeDefined();
      expect(stats.totalFavorites).toBeGreaterThanOrEqual(3);
      expect(stats.uniqueUsers).toBeGreaterThanOrEqual(2);
      expect(stats.uniqueQuotes).toBeGreaterThanOrEqual(2);
      expect(stats.averageFavoritesPerUser).toBeGreaterThan(0);
    });

    test('should handle concurrent favorites operations', async () => {
      const quoteId = 1;
      
      // Множественные одновременные операции
      const promises = [
        favorites.addToFavorites(testDatabase, testChatId, quoteId),
        favorites.addToFavorites(testDatabase, testChatId + 1, quoteId),
        favorites.addToFavorites(testDatabase, testChatId + 2, quoteId),
        favorites.removeFromFavorites(testDatabase, testChatId, quoteId),
        favorites.isFavorite(testDatabase, testChatId, quoteId),
        favorites.toggleFavorite(testDatabase, testChatId + 3, quoteId)
      ];
      
      const results = await Promise.allSettled(promises);
      
      // Большинство операций должно успешно выполниться
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(results.length * 0.8);
    });
  });

  describe('Performance Tests', () => {
    test('should handle large number of favorites efficiently', async () => {
      // Добавляем много избранных
      const promises = [];
      for (let i = 1; i <= 100; i++) {
        promises.push(
          testDatabase.run(
            'INSERT INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
            [testChatId, (i % 5) + 1, new Date().toISOString()]
          )
        );
      }
      await Promise.all(promises);
      
      const startTime = Date.now();
      const userFavorites = await favorites.getUserFavorites(testDatabase, testChatId);
      const endTime = Date.now();
      
      expect(userFavorites.length).toBe(100);
      expect(endTime - startTime).toBeLessThan(1000); // 1 секунда максимум
    });

    test('should perform pagination efficiently', async () => {
      // Добавляем много избранных для пагинации
      for (let i = 1; i <= 50; i++) {
        await testDatabase.run(
          'INSERT INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
          [testChatId, (i % 5) + 1, new Date().toISOString()]
        );
      }
      
      const startTime = Date.now();
      
      // Получаем несколько страниц
      const pages = [];
      for (let page = 1; page <= 5; page++) {
        const pageData = await favorites.getUserFavorites(testDatabase, testChatId, page, 10);
        pages.push(pageData);
      }
      
      const endTime = Date.now();
      
      expect(pages.length).toBe(5);
      expect(pages[0].length).toBe(10);
      expect(endTime - startTime).toBeLessThan(500); // 500ms максимум
    });

    test('should handle bulk operations efficiently', async () => {
      const quoteIds = [1, 2, 3, 4, 5];
      
      const startTime = Date.now();
      
      // Массовое добавление в избранное
      for (const quoteId of quoteIds) {
        await favorites.addToFavorites(testDatabase, testChatId, quoteId);
      }
      
      // Массовая проверка избранного
      for (const quoteId of quoteIds) {
        await favorites.isFavorite(testDatabase, testChatId, quoteId);
      }
      
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(200); // 200ms максимум
    });
  });

  describe('Data Integrity', () => {
    test('should maintain referential integrity', async () => {
      const quoteId = 1;
      
      // Добавляем в избранное
      await favorites.addToFavorites(testDatabase, testChatId, quoteId);
      
      // Проверяем что цитата существует
      const quote = await testDatabase.get('SELECT * FROM quotes WHERE id = ?', [quoteId]);
      expect(quote).toBeDefined();
      
      // Проверяем что пользователь существует
      const user = await testDatabase.get('SELECT * FROM users WHERE chat_id = ?', [testChatId]);
      expect(user).toBeDefined();
    });

    test('should handle foreign key constraints', async () => {
      const nonExistentQuoteId = 99999;
      
      // Попытка добавить несуществующую цитату в избранное
      const result = await favorites.addToFavorites(testDatabase, testChatId, nonExistentQuoteId);
      expect(result).toBe(false);
      
      // Проверяем что запись не создалась
      const favorite = await testDatabase.get(
        'SELECT * FROM favorite_quotes WHERE quote_id = ?', [nonExistentQuoteId]
      );
      expect(favorite).toBeUndefined();
    });

    test('should handle database transactions correctly', async () => {
      const quoteId = 1;
      
      // Симулируем транзакцию
      await testDatabase.run('BEGIN TRANSACTION');
      
      try {
        await favorites.addToFavorites(testDatabase, testChatId, quoteId);
        await testDatabase.run('COMMIT');
        
        const isFav = await favorites.isFavorite(testDatabase, testChatId, quoteId);
        expect(isFav).toBe(true);
      } catch (error) {
        await testDatabase.run('ROLLBACK');
        throw error;
      }
    });
  });
});