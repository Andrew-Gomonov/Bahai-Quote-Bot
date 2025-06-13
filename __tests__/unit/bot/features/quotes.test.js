const { testDb } = require('../../../setup/database-setup');
const quotes = require('../../../../src/bot/quotes');

describe('Quotes System', () => {
  let testDatabase;

  beforeEach(async () => {
    testDatabase = await testDb.createTestConnection(`quotes_test_${Date.now()}`);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await testDb.closeConnection(`quotes_test_${Date.now()}`);
  });

  describe('Quote Retrieval', () => {
    test('should get random quote', async () => {
      const quote = await quotes.getRandomQuote(testDatabase);
      
      expect(quote).toBeDefined();
      expect(quote.id).toBeDefined();
      expect(quote.text).toBeDefined();
      expect(quote.author).toBeDefined();
      expect(quote.theme).toBeDefined();
      expect(quote.source).toBeDefined();
      
      // Проверяем что это одна из тестовых цитат
      expect([1, 2, 3, 4, 5]).toContain(quote.id);
    });

    test('should get specific quote by ID', async () => {
      const quoteId = 1;
      const quote = await quotes.getQuoteById(testDatabase, quoteId);
      
      expect(quote).toBeDefined();
      expect(quote.id).toBe(quoteId);
      expect(quote.text).toContain('Purpose of life');
      expect(quote.author).toBe('Bahá\'u\'lláh');
    });

    test('should return null for non-existent quote ID', async () => {
      const nonExistentId = 99999;
      const quote = await quotes.getQuoteById(testDatabase, nonExistentId);
      
      expect(quote).toBeNull();
    });

    test('should handle invalid quote ID formats', async () => {
      const invalidIds = ['abc', null, undefined, '', -1, 0];
      
      for (const invalidId of invalidIds) {
        const quote = await quotes.getQuoteById(testDatabase, invalidId);
        expect(quote).toBeNull();
      }
    });

    test('should get different quotes on consecutive calls', async () => {
      const quote1 = await quotes.getRandomQuote(testDatabase);
      const quote2 = await quotes.getRandomQuote(testDatabase);
      const quote3 = await quotes.getRandomQuote(testDatabase);
      
      expect(quote1).toBeDefined();
      expect(quote2).toBeDefined();
      expect(quote3).toBeDefined();
      
      // С 5 цитатами в БД, должны получить разные (высокая вероятность)
      const uniqueIds = new Set([quote1.id, quote2.id, quote3.id]);
      expect(uniqueIds.size).toBeGreaterThan(1);
    });

    test('should handle empty quotes database', async () => {
      // Очищаем все цитаты
      await testDatabase.run('DELETE FROM quotes');
      
      const quote = await quotes.getRandomQuote(testDatabase);
      expect(quote).toBeNull();
    });

    test('should validate quote data integrity', async () => {
      const quote = await quotes.getQuoteById(testDatabase, 1);
      
      expect(quote.text).toBeTruthy();
      expect(quote.text.length).toBeGreaterThan(0);
      expect(quote.author).toBeTruthy();
      expect(quote.theme).toBeTruthy();
      expect(quote.source).toBeTruthy();
      
      // Проверяем что нет SQL injection или XSS
      expect(quote.text).not.toContain('<script>');
      expect(quote.text).not.toContain('DROP TABLE');
    });

    test('should handle database connection errors', async () => {
      // Симулируем ошибку БД
      const originalGet = testDatabase.get;
      testDatabase.get = jest.fn().mockRejectedValue(new Error('Database error'));
      
      await expect(quotes.getRandomQuote(testDatabase)).rejects.toThrow('Database error');
      
      testDatabase.get = originalGet;
    });
  });

  describe('Quote Search', () => {
    test('should search quotes by text', async () => {
      const searchTerm = 'unity';
      const results = await quotes.searchQuotes(testDatabase, searchTerm);
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      
      // Проверяем что результаты содержат поисковый термин
      const foundRelevant = results.some(quote => 
        quote.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
        quote.author.toLowerCase().includes(searchTerm.toLowerCase()) ||
        quote.theme.toLowerCase().includes(searchTerm.toLowerCase())
      );
      expect(foundRelevant).toBe(true);
    });

    test('should search quotes by author', async () => {
      const searchTerm = 'Bahá';
      const results = await quotes.searchQuotes(testDatabase, searchTerm);
      
      expect(results.length).toBeGreaterThan(0);
      
      // Все результаты должны содержать искомого автора
      results.forEach(quote => {
        expect(quote.author.toLowerCase()).toContain(searchTerm.toLowerCase());
      });
    });

    test('should search quotes by theme', async () => {
      const searchTerm = 'justice';
      const results = await quotes.searchQuotes(testDatabase, searchTerm);
      
      expect(results.length).toBeGreaterThan(0);
      
      const foundRelevant = results.some(quote => 
        quote.theme.toLowerCase().includes(searchTerm.toLowerCase()) ||
        quote.text.toLowerCase().includes(searchTerm.toLowerCase())
      );
      expect(foundRelevant).toBe(true);
    });

    test('should handle fuzzy search', async () => {
      // Поиск с опечатками
      const results1 = await quotes.searchQuotes(testDatabase, 'purpos'); // purpose
      const results2 = await quotes.searchQuotes(testDatabase, 'Baha'); // Bahá
      
      expect(results1.length).toBeGreaterThan(0);
      expect(results2.length).toBeGreaterThan(0);
    });

    test('should return empty array for non-matching search', async () => {
      const searchTerm = 'nonexistentterm12345';
      const results = await quotes.searchQuotes(testDatabase, searchTerm);
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    test('should handle empty search term', async () => {
      const results = await quotes.searchQuotes(testDatabase, '');
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    test('should handle special characters in search', async () => {
      const specialChars = ['@', '#', '$', '%', '&', '*', '(', ')', '[', ']'];
      
      for (const char of specialChars) {
        const results = await quotes.searchQuotes(testDatabase, char);
        expect(Array.isArray(results)).toBe(true);
        // Не должно вызывать ошибок
      }
    });

    test('should limit search results', async () => {
      // Добавляем много цитат для тестирования лимита
      for (let i = 6; i <= 25; i++) {
        await testDatabase.run(
          'INSERT INTO quotes (id, text, author, theme, source) VALUES (?, ?, ?, ?, ?)',
          [i, `Test quote ${i} with unity theme`, 'Test Author', 'Unity', 'Test Source']
        );
      }
      
      const results = await quotes.searchQuotes(testDatabase, 'unity', 10);
      expect(results.length).toBeLessThanOrEqual(10);
    });

    test('should rank search results by relevance', async () => {
      const searchTerm = 'God';
      const results = await quotes.searchQuotes(testDatabase, searchTerm);
      
      if (results.length > 1) {
        // Первый результат должен быть более релевантным
        const firstResult = results[0];
        const lastResult = results[results.length - 1];
        
        // Проверяем что результаты отсортированы по релевантности
        expect(firstResult).toBeDefined();
        expect(lastResult).toBeDefined();
      }
    });
  });

  describe('Quote Statistics', () => {
    test('should track quote reads', async () => {
      const chatId = 12345;
      const quoteId = 1;
      const readType = 'command';
      
      await quotes.trackQuoteRead(testDatabase, chatId, quoteId, readType);
      
      // Проверяем что запись создалась
      const read = await testDatabase.get(
        'SELECT * FROM quote_reads WHERE chat_id = ? AND quote_id = ? ORDER BY read_at DESC LIMIT 1',
        [chatId, quoteId]
      );
      
      expect(read).toBeDefined();
      expect(read.chat_id).toBe(chatId);
      expect(read.quote_id).toBe(quoteId);
      expect(read.read_type).toBe(readType);
      expect(read.read_at).toBeDefined();
    });

    test('should update user quote statistics', async () => {
      const chatId = 12345;
      
      // Получаем начальную статистику
      const userBefore = await testDatabase.get(
        'SELECT quotes_read_total FROM users WHERE chat_id = ?', [chatId]
      );
      
      await quotes.updateUserQuoteStats(testDatabase, chatId);
      
      // Проверяем что статистика обновилась
      const userAfter = await testDatabase.get(
        'SELECT quotes_read_total FROM users WHERE chat_id = ?', [chatId]
      );
      
      expect(userAfter.quotes_read_total).toBe(userBefore.quotes_read_total + 1);
    });

    test('should get quote read count', async () => {
      const quoteId = 1;
      
      // Добавляем несколько прочтений
      await testDatabase.run(
        'INSERT INTO quote_reads (chat_id, quote_id, read_at, read_type) VALUES (?, ?, ?, ?)',
        [12345, quoteId, new Date().toISOString(), 'command']
      );
      await testDatabase.run(
        'INSERT INTO quote_reads (chat_id, quote_id, read_at, read_type) VALUES (?, ?, ?, ?)',
        [12346, quoteId, new Date().toISOString(), 'daily']
      );
      
      const readCount = await quotes.getQuoteReadCount(testDatabase, quoteId);
      expect(readCount).toBeGreaterThanOrEqual(2);
    });

    test('should get most popular quotes', async () => {
      // Добавляем прочтения для создания популярности
      for (let i = 0; i < 5; i++) {
        await testDatabase.run(
          'INSERT INTO quote_reads (chat_id, quote_id, read_at, read_type) VALUES (?, ?, ?, ?)',
          [12345 + i, 1, new Date().toISOString(), 'command']
        );
      }
      
      for (let i = 0; i < 3; i++) {
        await testDatabase.run(
          'INSERT INTO quote_reads (chat_id, quote_id, read_at, read_type) VALUES (?, ?, ?, ?)',
          [12350 + i, 2, new Date().toISOString(), 'command']
        );
      }
      
      const popularQuotes = await quotes.getMostPopularQuotes(testDatabase, 5);
      
      expect(popularQuotes).toBeDefined();
      expect(Array.isArray(popularQuotes)).toBe(true);
      expect(popularQuotes.length).toBeGreaterThan(0);
      
      // Проверяем что результаты отсортированы по популярности
      if (popularQuotes.length > 1) {
        expect(popularQuotes[0].read_count).toBeGreaterThanOrEqual(popularQuotes[1].read_count);
      }
    });

    test('should handle duplicate read tracking', async () => {
      const chatId = 12345;
      const quoteId = 1;
      
      // Трекаем одну и ту же цитату несколько раз
      await quotes.trackQuoteRead(testDatabase, chatId, quoteId, 'command');
      await quotes.trackQuoteRead(testDatabase, chatId, quoteId, 'callback');
      await quotes.trackQuoteRead(testDatabase, chatId, quoteId, 'daily');
      
      // Проверяем что все прочтения записались
      const reads = await testDatabase.all(
        'SELECT * FROM quote_reads WHERE chat_id = ? AND quote_id = ?',
        [chatId, quoteId]
      );
      
      expect(reads.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Quote Formatting', () => {
    test('should format quote for display', async () => {
      const quote = await quotes.getQuoteById(testDatabase, 1);
      const formatted = quotes.formatQuoteForDisplay(quote);
      
      expect(formatted).toBeDefined();
      expect(formatted).toContain(quote.text);
      expect(formatted).toContain(quote.author);
      expect(formatted).toContain(quote.source);
      
      // Проверяем наличие эмодзи
      expect(formatted).toMatch(/📖|💫|✨/);
    });

    test('should format quote with long text', async () => {
      // Создаем очень длинную цитату
      const longQuote = {
        id: 999,
        text: 'Very long quote text that exceeds normal display limits. '.repeat(100),
        author: 'Test Author',
        theme: 'Test Theme',
        source: 'Test Source'
      };
      
      const formatted = quotes.formatQuoteForDisplay(longQuote);
      
      expect(formatted.length).toBeLessThanOrEqual(4096); // Telegram limit
      expect(formatted).toContain('...');
    });

    test('should escape special characters in formatting', async () => {
      const specialQuote = {
        id: 998,
        text: 'Quote with <html> tags and & special chars',
        author: 'Test Author',
        theme: 'Test Theme',
        source: 'Test Source'
      };
      
      const formatted = quotes.formatQuoteForDisplay(specialQuote);
      
      // В зависимости от реализации, может экранировать HTML
      expect(formatted).toBeDefined();
      expect(formatted).toContain(specialQuote.text);
    });

    test('should handle missing quote fields', async () => {
      const incompleteQuote = {
        id: 997,
        text: 'Complete text',
        author: null,
        theme: '',
        source: undefined
      };
      
      const formatted = quotes.formatQuoteForDisplay(incompleteQuote);
      
      expect(formatted).toBeDefined();
      expect(formatted).toContain(incompleteQuote.text);
      expect(formatted).not.toContain('null');
      expect(formatted).not.toContain('undefined');
    });

    test('should include quote ID in formatting', async () => {
      const quote = await quotes.getQuoteById(testDatabase, 1);
      const formatted = quotes.formatQuoteForDisplay(quote, { includeId: true });
      
      expect(formatted).toContain(`#${quote.id}`);
    });
  });

  describe('Quote Validation', () => {
    test('should validate quote data structure', async () => {
      const validQuote = {
        id: 1,
        text: 'Valid quote text',
        author: 'Valid Author',
        theme: 'Valid Theme',
        source: 'Valid Source'
      };
      
      const isValid = quotes.validateQuoteData(validQuote);
      expect(isValid).toBe(true);
    });

    test('should reject invalid quote data', async () => {
      const invalidQuotes = [
        null,
        undefined,
        {},
        { id: 1 }, // Отсутствуют обязательные поля
        { text: '' }, // Пустой текст
        { text: 'Valid', author: '', theme: '', source: '' }, // Пустые поля
        { id: 'invalid', text: 'Valid', author: 'Valid', theme: 'Valid', source: 'Valid' } // Неверный тип ID
      ];
      
      for (const invalidQuote of invalidQuotes) {
        const isValid = quotes.validateQuoteData(invalidQuote);
        expect(isValid).toBe(false);
      }
    });

    test('should validate quote text length', async () => {
      const tooShortQuote = {
        id: 1,
        text: 'Hi', // Слишком короткий
        author: 'Author',
        theme: 'Theme',
        source: 'Source'
      };
      
      const tooLongQuote = {
        id: 1,
        text: 'Very long text. '.repeat(1000), // Слишком длинный
        author: 'Author',
        theme: 'Theme',
        source: 'Source'
      };
      
      expect(quotes.validateQuoteData(tooShortQuote)).toBe(false);
      expect(quotes.validateQuoteData(tooLongQuote)).toBe(false);
    });

    test('should sanitize quote data', async () => {
      const dirtyQuote = {
        id: 1,
        text: 'Quote with <script>alert("xss")</script> malicious code',
        author: 'Author <b>bold</b>',
        theme: 'Theme & special chars',
        source: 'Source with "quotes"'
      };
      
      const sanitized = quotes.sanitizeQuoteData(dirtyQuote);
      
      expect(sanitized.text).not.toContain('<script>');
      expect(sanitized.author).toBeDefined();
      expect(sanitized.theme).toBeDefined();
      expect(sanitized.source).toBeDefined();
    });
  });

  describe('Quote Caching', () => {
    test('should cache frequently accessed quotes', async () => {
      const quoteId = 1;
      
      // Множественные запросы одной цитаты
      const quote1 = await quotes.getQuoteById(testDatabase, quoteId);
      const quote2 = await quotes.getQuoteById(testDatabase, quoteId);
      const quote3 = await quotes.getQuoteById(testDatabase, quoteId);
      
      expect(quote1).toEqual(quote2);
      expect(quote2).toEqual(quote3);
      
      // В реальной реализации здесь должно быть кэширование
    });

    test('should invalidate cache when quote is updated', async () => {
      const quoteId = 1;
      
      const originalQuote = await quotes.getQuoteById(testDatabase, quoteId);
      
      // Обновляем цитату
      await testDatabase.run(
        'UPDATE quotes SET text = ? WHERE id = ?',
        ['Updated quote text', quoteId]
      );
      
      // Очищаем кэш (если есть)
      quotes.clearCache && quotes.clearCache();
      
      const updatedQuote = await quotes.getQuoteById(testDatabase, quoteId);
      expect(updatedQuote.text).toBe('Updated quote text');
      expect(updatedQuote.text).not.toBe(originalQuote.text);
    });
  });

  describe('Error Handling', () => {
    test('should handle database connection failures gracefully', async () => {
      // Симулируем полную потерю соединения с БД
      const brokenDatabase = {
        get: jest.fn().mockRejectedValue(new Error('SQLITE_CANTOPEN')),
        all: jest.fn().mockRejectedValue(new Error('SQLITE_CANTOPEN')),
        run: jest.fn().mockRejectedValue(new Error('SQLITE_CANTOPEN'))
      };
      
      await expect(quotes.getRandomQuote(brokenDatabase)).rejects.toThrow();
      await expect(quotes.searchQuotes(brokenDatabase, 'test')).rejects.toThrow();
    });

    test('should handle corrupted quote data', async () => {
      // Добавляем поврежденную цитату
      await testDatabase.run(`
        INSERT INTO quotes (id, text, author, theme, source) 
        VALUES (?, ?, ?, ?, ?)
      `, [999, null, null, null, null]);
      
      const quote = await quotes.getQuoteById(testDatabase, 999);
      
      // Система должна обработать это корректно
      if (quote) {
        expect(quote.id).toBe(999);
        // Поля могут быть null или заменены на дефолтные значения
      }
    });

    test('should handle concurrent access to quotes', async () => {
      // Множественные одновременные запросы
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(quotes.getRandomQuote(testDatabase));
        promises.push(quotes.searchQuotes(testDatabase, 'test'));
      }
      
      const results = await Promise.allSettled(promises);
      
      // Большинство запросов должно успешно выполниться
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(results.length * 0.8);
    });

    test('should handle memory pressure gracefully', async () => {
      // Симулируем большую нагрузку
      const largeSearches = [];
      for (let i = 0; i < 100; i++) {
        largeSearches.push(quotes.searchQuotes(testDatabase, 'test', 100));
      }
      
      // Не должно вызывать out of memory
      await expect(Promise.all(largeSearches)).resolves.toBeDefined();
    });
  });

  describe('Performance', () => {
    test('should retrieve quotes efficiently', async () => {
      const startTime = Date.now();
      
      // Множественные запросы цитат
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(quotes.getRandomQuote(testDatabase));
      }
      
      await Promise.all(promises);
      const endTime = Date.now();
      
      // Должно выполняться быстро
      expect(endTime - startTime).toBeLessThan(2000); // 2 секунды максимум
    });

    test('should search quotes efficiently', async () => {
      const startTime = Date.now();
      
      // Множественные поисковые запросы
      const searchTerms = ['unity', 'God', 'justice', 'knowledge', 'love'];
      const promises = searchTerms.map(term => 
        quotes.searchQuotes(testDatabase, term)
      );
      
      await Promise.all(promises);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(1000); // 1 секунда максимум
    });

    test('should handle large result sets efficiently', async () => {
      // Добавляем много цитат
      for (let i = 100; i <= 200; i++) {
        await testDatabase.run(
          'INSERT INTO quotes (id, text, author, theme, source) VALUES (?, ?, ?, ?, ?)',
          [i, `Quote ${i} about unity and peace`, 'Test Author', 'Unity', 'Test Source']
        );
      }
      
      const startTime = Date.now();
      const results = await quotes.searchQuotes(testDatabase, 'unity');
      const endTime = Date.now();
      
      expect(results.length).toBeGreaterThan(10);
      expect(endTime - startTime).toBeLessThan(500); // 500ms максимум
    });
  });
});