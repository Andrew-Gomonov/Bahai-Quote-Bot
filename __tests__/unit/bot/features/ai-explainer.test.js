const { testDb } = require('../../../setup/database-setup');
const { MockOpenAI } = require('../../../setup/mocks/openai-api');
const aiExplainer = require('../../../../src/bot/aiExplainer');

describe('AI Explainer System', () => {
  let testDatabase;
  let mockOpenAI;

  beforeEach(async () => {
    testDatabase = await testDb.createTestConnection(`ai_test_${Date.now()}`);
    mockOpenAI = new MockOpenAI();
    jest.clearAllMocks();
    
    // Настраиваем глобальный fetch мок
    global.fetch = jest.fn();
  });

  afterEach(async () => {
    await testDb.closeConnection(`ai_test_${Date.now()}`);
  });

  describe('AI Explainer Status Management', () => {
    test('should check if AI explainer is enabled', async () => {
      const isEnabled = await aiExplainer.isEnabled(testDatabase);
      expect(typeof isEnabled).toBe('boolean');
      expect(isEnabled).toBe(true); // По умолчанию включен в тестовых данных
    });

    test('should disable AI explainer', async () => {
      const reason = 'Test disable reason';
      const result = await aiExplainer.disable(testDatabase, reason);
      
      expect(result).toBe(true);
      
      // Проверяем статус в БД
      const status = await testDatabase.get('SELECT * FROM ai_explainer_status WHERE rowid = 1');
      expect(status.enabled).toBe(0);
      expect(status.disable_reason).toBe(reason);
      expect(status.disabled_at).toBeDefined();
    });

    test('should enable AI explainer', async () => {
      // Сначала отключаем
      await aiExplainer.disable(testDatabase, 'Test');
      
      const result = await aiExplainer.enable(testDatabase);
      expect(result).toBe(true);
      
      // Проверяем статус в БД
      const status = await testDatabase.get('SELECT * FROM ai_explainer_status WHERE rowid = 1');
      expect(status.enabled).toBe(1);
      expect(status.enabled_at).toBeDefined();
      expect(status.disable_reason).toBeNull();
    });

    test('should get AI explainer status details', async () => {
      const status = await aiExplainer.getStatus(testDatabase);
      
      expect(status).toBeDefined();
      expect(status.enabled).toBeDefined();
      expect(status.disabled_at).toBeDefined();
      expect(status.enabled_at).toBeDefined();
    });

    test('should handle database errors in status operations', async () => {
      const originalGet = testDatabase.get;
      testDatabase.get = jest.fn().mockRejectedValue(new Error('Database error'));
      
      const isEnabled = await aiExplainer.isEnabled(testDatabase);
      expect(isEnabled).toBe(false); // По умолчанию false при ошибке
      
      testDatabase.get = originalGet;
    });
  });

  describe('Generate Explanations', () => {
    beforeEach(() => {
      // Настраиваем успешный ответ OpenAI по умолчанию
      mockOpenAI.setMockResponse('chat_completion', {
        choices: [{
          message: {
            content: 'This is a test AI explanation of the quote about spiritual growth and unity.'
          }
        }],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 30,
          total_tokens: 80
        }
      });
      
      // Мокаем fetch для OpenAI API
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockOpenAI.mockResponses.get('chat_completion')
      });
    });

    test('should generate explanation for quote', async () => {
      const quote = {
        id: 1,
        text: 'The purpose of life is to worship God and to serve humanity.',
        author: 'Bahá\'u\'lláh',
        theme: 'Purpose of Life',
        source: 'Kitab-i-Aqdas'
      };
      
      const explanation = await aiExplainer.generateExplanation(testDatabase, quote);
      
      expect(explanation).toBeDefined();
      expect(explanation.length).toBeGreaterThan(0);
      expect(explanation).toContain('spiritual growth');
      
      // Проверяем что fetch был вызван
      expect(global.fetch).toHaveBeenCalled();
    });

    test('should use cached explanation when available', async () => {
      const quoteId = 1;
      const cachedExplanation = 'This is a cached explanation from the database';
      
      // Добавляем кэшированное объяснение
      await testDatabase.run(
        'INSERT OR REPLACE INTO quote_explanations (quote_id, explanation, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [quoteId, cachedExplanation, new Date().toISOString(), new Date().toISOString()]
      );
      
      const quote = { id: quoteId, text: 'Test quote', author: 'Test', theme: 'Test', source: 'Test' };
      const explanation = await aiExplainer.generateExplanation(testDatabase, quote);
      
      expect(explanation).toBe(cachedExplanation);
      
      // Проверяем что OpenAI API не был вызван
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should handle OpenAI API errors gracefully', async () => {
      // Симулируем ошибку API
      global.fetch.mockRejectedValue(new Error('OpenAI API Error'));
      
      const quote = { id: 1, text: 'Test quote', author: 'Test', theme: 'Test', source: 'Test' };
      
      await expect(aiExplainer.generateExplanation(testDatabase, quote)).rejects.toThrow('OpenAI API Error');
    });

    test('should handle rate limiting from OpenAI', async () => {
      // Симулируем rate limiting
      global.fetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Rate limit exceeded' } })
      });
      
      const quote = { id: 1, text: 'Test quote', author: 'Test', theme: 'Test', source: 'Test' };
      
      await expect(aiExplainer.generateExplanation(testDatabase, quote)).rejects.toThrow();
    });

    test('should handle invalid API key', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API key' } })
      });
      
      const quote = { id: 1, text: 'Test quote', author: 'Test', theme: 'Test', source: 'Test' };
      
      await expect(aiExplainer.generateExplanation(testDatabase, quote)).rejects.toThrow();
    });

    test('should save generated explanation to cache', async () => {
      const quote = {
        id: 999,
        text: 'New quote for caching test',
        author: 'Test Author',
        theme: 'Test Theme',
        source: 'Test Source'
      };
      
      const explanation = await aiExplainer.generateExplanation(testDatabase, quote);
      
      // Проверяем что объяснение сохранилось в кэш
      const cached = await testDatabase.get(
        'SELECT * FROM quote_explanations WHERE quote_id = ?', [quote.id]
      );
      
      expect(cached).toBeDefined();
      expect(cached.explanation).toBe(explanation);
      expect(cached.created_at).toBeDefined();
      expect(cached.updated_at).toBeDefined();
    });

    test('should handle quotes with special characters', async () => {
      const quote = {
        id: 998,
        text: 'Quote with "quotes" and <special> chars & symbols',
        author: 'Test Author',
        theme: 'Test',
        source: 'Test'
      };
      
      const explanation = await aiExplainer.generateExplanation(testDatabase, quote);
      
      expect(explanation).toBeDefined();
      expect(explanation.length).toBeGreaterThan(0);
      
      // Проверяем что fetch был вызван с правильными данными
      expect(global.fetch).toHaveBeenCalled();
      const fetchCall = global.fetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody.messages[0].content).toContain(quote.text);
    });

    test('should handle very long quotes', async () => {
      const longQuote = {
        id: 997,
        text: 'Very long quote text that might exceed token limits. '.repeat(200),
        author: 'Test Author',
        theme: 'Test',
        source: 'Test'
      };
      
      const explanation = await aiExplainer.generateExplanation(testDatabase, longQuote);
      
      expect(explanation).toBeDefined();
      expect(explanation.length).toBeGreaterThan(0);
    });

    test('should respect disabled status', async () => {
      // Отключаем AI explainer
      await aiExplainer.disable(testDatabase, 'Test disable');
      
      const quote = { id: 1, text: 'Test quote', author: 'Test', theme: 'Test', source: 'Test' };
      
      await expect(aiExplainer.generateExplanation(testDatabase, quote))
        .rejects.toThrow('AI Explainer is currently disabled');
    });
  });

  describe('Explanation Caching', () => {
    test('should retrieve cached explanation', async () => {
      const quoteId = 1;
      const explanation = 'Cached explanation text';
      
      // Добавляем в кэш
      await testDatabase.run(
        'INSERT INTO quote_explanations (quote_id, explanation, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [quoteId, explanation, new Date().toISOString(), new Date().toISOString()]
      );
      
      const cached = await aiExplainer.getCachedExplanation(testDatabase, quoteId);
      
      expect(cached).toBeDefined();
      expect(cached.explanation).toBe(explanation);
      expect(cached.quote_id).toBe(quoteId);
    });

    test('should return null for non-cached explanation', async () => {
      const nonCachedQuoteId = 99999;
      
      const cached = await aiExplainer.getCachedExplanation(testDatabase, nonCachedQuoteId);
      expect(cached).toBeNull();
    });

    test('should cache new explanation', async () => {
      const quoteId = 996;
      const explanation = 'New explanation to cache';
      
      const result = await aiExplainer.cacheExplanation(testDatabase, quoteId, explanation);
      expect(result).toBe(true);
      
      // Проверяем что сохранилось
      const cached = await testDatabase.get(
        'SELECT * FROM quote_explanations WHERE quote_id = ?', [quoteId]
      );
      
      expect(cached).toBeDefined();
      expect(cached.explanation).toBe(explanation);
    });

    test('should update existing cached explanation', async () => {
      const quoteId = 1;
      const oldExplanation = 'Old explanation';
      const newExplanation = 'Updated explanation';
      
      // Добавляем старое объяснение
      await testDatabase.run(
        'INSERT INTO quote_explanations (quote_id, explanation, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [quoteId, oldExplanation, new Date(Date.now() - 3600000).toISOString(), new Date(Date.now() - 3600000).toISOString()]
      );
      
      // Обновляем
      const result = await aiExplainer.cacheExplanation(testDatabase, quoteId, newExplanation);
      expect(result).toBe(true);
      
      // Проверяем что обновилось
      const cached = await testDatabase.get(
        'SELECT * FROM quote_explanations WHERE quote_id = ?', [quoteId]
      );
      
      expect(cached.explanation).toBe(newExplanation);
      expect(cached.updated_at).toBeGreaterThan(cached.created_at);
    });

    test('should handle database errors in caching', async () => {
      const originalRun = testDatabase.run;
      testDatabase.run = jest.fn().mockRejectedValue(new Error('Database error'));
      
      const result = await aiExplainer.cacheExplanation(testDatabase, 1, 'Test explanation');
      expect(result).toBe(false);
      
      testDatabase.run = originalRun;
    });

    test('should clean up old cached explanations', async () => {
      const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 дней назад
      
      // Добавляем старое объяснение
      await testDatabase.run(
        'INSERT INTO quote_explanations (quote_id, explanation, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [995, 'Old explanation', oldDate, oldDate]
      );
      
      // Очищаем старые
      const cleaned = await aiExplainer.cleanupOldExplanations(testDatabase, 30); // Старше 30 дней
      
      expect(cleaned).toBeGreaterThan(0);
      
      // Проверяем что старое объяснение удалилось
      const oldExplanation = await testDatabase.get(
        'SELECT * FROM quote_explanations WHERE quote_id = ?', [995]
      );
      expect(oldExplanation).toBeUndefined();
    });
  });

  describe('Explanation Quality and Validation', () => {
    test('should validate explanation quality', async () => {
      const goodExplanation = 'This quote teaches us about the importance of spiritual growth and unity. It reminds us that true happiness comes from serving others and developing our spiritual qualities.';
      const poorExplanation = 'Yes.';
      const emptyExplanation = '';
      
      expect(aiExplainer.validateExplanationQuality(goodExplanation)).toBe(true);
      expect(aiExplainer.validateExplanationQuality(poorExplanation)).toBe(false);
      expect(aiExplainer.validateExplanationQuality(emptyExplanation)).toBe(false);
    });

    test('should filter inappropriate content', async () => {
      const appropriateExplanation = 'This quote teaches about spiritual growth.';
      const inappropriateExplanation = 'This quote contains inappropriate content and hate speech.';
      
      expect(aiExplainer.isContentAppropriate(appropriateExplanation)).toBe(true);
      expect(aiExplainer.isContentAppropriate(inappropriateExplanation)).toBe(false);
    });

    test('should handle explanations with different languages', async () => {
      // Настраиваем ответ на русском
      mockOpenAI.setMockResponse('chat_completion', {
        choices: [{
          message: {
            content: 'Эта цитата учит нас о важности духовного роста и единства.'
          }
        }]
      });
      
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockOpenAI.mockResponses.get('chat_completion')
      });
      
      const quote = { id: 994, text: 'Test quote', author: 'Test', theme: 'Test', source: 'Test' };
      const explanation = await aiExplainer.generateExplanation(testDatabase, quote, { language: 'ru' });
      
      expect(explanation).toContain('духовного роста');
    });

    test('should handle explanation length limits', async () => {
      // Симулируем очень длинное объяснение
      const longExplanation = 'Very long explanation. '.repeat(1000);
      
      mockOpenAI.setMockResponse('chat_completion', {
        choices: [{
          message: {
            content: longExplanation
          }
        }]
      });
      
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockOpenAI.mockResponses.get('chat_completion')
      });
      
      const quote = { id: 993, text: 'Test quote', author: 'Test', theme: 'Test', source: 'Test' };
      const explanation = await aiExplainer.generateExplanation(testDatabase, quote);
      
      // Объяснение должно быть обрезано до разумной длины
      expect(explanation.length).toBeLessThan(2000);
    });
  });

  describe('Usage Statistics', () => {
    test('should track explanation requests', async () => {
      const quoteId = 1;
      const chatId = 12345;
      
      await aiExplainer.trackExplanationRequest(testDatabase, quoteId, chatId);
      
      // Проверяем что запрос зафиксирован
      const stats = await aiExplainer.getUsageStatistics(testDatabase);
      expect(stats.totalRequests).toBeGreaterThan(0);
    });

    test('should get usage statistics', async () => {
      // Добавляем несколько запросов для статистики
      await aiExplainer.trackExplanationRequest(testDatabase, 1, 12345);
      await aiExplainer.trackExplanationRequest(testDatabase, 2, 12345);
      await aiExplainer.trackExplanationRequest(testDatabase, 1, 67890);
      
      const stats = await aiExplainer.getUsageStatistics(testDatabase);
      
      expect(stats).toBeDefined();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(3);
      expect(stats.uniqueQuotes).toBeGreaterThanOrEqual(2);
      expect(stats.uniqueUsers).toBeGreaterThanOrEqual(2);
      expect(stats.averageRequestsPerUser).toBeGreaterThan(0);
    });

    test('should get popular quotes for explanations', async () => {
      // Добавляем запросы для разных цитат
      for (let i = 0; i < 5; i++) {
        await aiExplainer.trackExplanationRequest(testDatabase, 1, 12345 + i);
      }
      for (let i = 0; i < 3; i++) {
        await aiExplainer.trackExplanationRequest(testDatabase, 2, 12350 + i);
      }
      
      const popularQuotes = await aiExplainer.getPopularExplanationQuotes(testDatabase, 5);
      
      expect(popularQuotes).toBeDefined();
      expect(Array.isArray(popularQuotes)).toBe(true);
      expect(popularQuotes.length).toBeGreaterThan(0);
      
      // Проверяем сортировку по популярности
      if (popularQuotes.length > 1) {
        expect(popularQuotes[0].request_count).toBeGreaterThanOrEqual(popularQuotes[1].request_count);
      }
    });
  });

  describe('Prompt Engineering', () => {
    test('should generate appropriate prompt for quote', async () => {
      const quote = {
        id: 1,
        text: 'The purpose of life is to worship God and to serve humanity.',
        author: 'Bahá\'u\'lláh',
        theme: 'Purpose of Life',
        source: 'Kitab-i-Aqdas'
      };
      
      const prompt = aiExplainer.generatePrompt(quote);
      
      expect(prompt).toBeDefined();
      expect(prompt).toContain(quote.text);
      expect(prompt).toContain(quote.author);
      expect(prompt).toContain('explain');
      expect(prompt).toContain('Bahá\'í');
    });

    test('should customize prompt for different themes', async () => {
      const unityQuote = { id: 1, text: 'Unity test', author: 'Test', theme: 'Unity', source: 'Test' };
      const justiceQuote = { id: 2, text: 'Justice test', author: 'Test', theme: 'Justice', source: 'Test' };
      
      const unityPrompt = aiExplainer.generatePrompt(unityQuote);
      const justicePrompt = aiExplainer.generatePrompt(justiceQuote);
      
      expect(unityPrompt).toContain('unity');
      expect(justicePrompt).toContain('justice');
      expect(unityPrompt).not.toEqual(justicePrompt);
    });

    test('should handle missing quote fields in prompt', async () => {
      const incompleteQuote = {
        id: 1,
        text: 'Complete text',
        author: null,
        theme: '',
        source: undefined
      };
      
      const prompt = aiExplainer.generatePrompt(incompleteQuote);
      
      expect(prompt).toBeDefined();
      expect(prompt).toContain(incompleteQuote.text);
      expect(prompt).not.toContain('null');
      expect(prompt).not.toContain('undefined');
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle API timeouts', async () => {
      // Симулируем таймаут
      global.fetch.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 100)
        )
      );
      
      const quote = { id: 1, text: 'Test quote', author: 'Test', theme: 'Test', source: 'Test' };
      
      await expect(aiExplainer.generateExplanation(testDatabase, quote))
        .rejects.toThrow('Request timeout');
    });

    test('should handle malformed API responses', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ invalid: 'response' })
      });
      
      const quote = { id: 1, text: 'Test quote', author: 'Test', theme: 'Test', source: 'Test' };
      
      await expect(aiExplainer.generateExplanation(testDatabase, quote))
        .rejects.toThrow();
    });

    test('should implement retry logic for transient failures', async () => {
      let callCount = 0;
      global.fetch.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Transient error'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockOpenAI.mockResponses.get('chat_completion')
        });
      });
      
      const quote = { id: 1, text: 'Test quote', author: 'Test', theme: 'Test', source: 'Test' };
      const explanation = await aiExplainer.generateExplanation(testDatabase, quote, { maxRetries: 3 });
      
      expect(explanation).toBeDefined();
      expect(callCount).toBe(3);
    });

    test('should fall back gracefully when AI is unavailable', async () => {
      global.fetch.mockRejectedValue(new Error('Service unavailable'));
      
      const quote = { id: 1, text: 'Test quote', author: 'Test', theme: 'Test', source: 'Test' };
      
      const fallbackExplanation = await aiExplainer.generateExplanation(
        testDatabase, 
        quote, 
        { fallbackToTemplate: true }
      );
      
      expect(fallbackExplanation).toBeDefined();
      expect(fallbackExplanation).toContain('объяснение временно недоступно');
    });
  });

  describe('Performance and Optimization', () => {
    test('should handle concurrent explanation requests', async () => {
      const quotes = [
        { id: 1, text: 'Quote 1', author: 'Author 1', theme: 'Theme 1', source: 'Source 1' },
        { id: 2, text: 'Quote 2', author: 'Author 2', theme: 'Theme 2', source: 'Source 2' },
        { id: 3, text: 'Quote 3', author: 'Author 3', theme: 'Theme 3', source: 'Source 3' }
      ];
      
      const promises = quotes.map(quote => 
        aiExplainer.generateExplanation(testDatabase, quote)
      );
      
      const results = await Promise.allSettled(promises);
      
      // Большинство запросов должно быть успешным
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(results.length * 0.8);
    });

    test('should implement request queuing for high load', async () => {
      const startTime = Date.now();
      
      // Множественные одновременные запросы
      const promises = [];
      for (let i = 0; i < 10; i++) {
        const quote = { id: i + 1, text: `Quote ${i}`, author: 'Test', theme: 'Test', source: 'Test' };
        promises.push(aiExplainer.generateExplanation(testDatabase, quote));
      }
      
      await Promise.all(promises);
      const endTime = Date.now();
      
      // Проверяем что запросы обработались в разумное время
      expect(endTime - startTime).toBeLessThan(10000); // 10 секунд максимум
    });

    test('should cache frequently requested explanations efficiently', async () => {
      const popularQuoteId = 1;
      const quote = { id: popularQuoteId, text: 'Popular quote', author: 'Test', theme: 'Test', source: 'Test' };
      
      // Первый запрос - генерируем объяснение
      const startTime1 = Date.now();
      const explanation1 = await aiExplainer.generateExplanation(testDatabase, quote);
      const endTime1 = Date.now();
      
      // Второй запрос - должен использовать кэш
      const startTime2 = Date.now();
      const explanation2 = await aiExplainer.generateExplanation(testDatabase, quote);
      const endTime2 = Date.now();
      
      expect(explanation1).toBe(explanation2);
      expect(endTime2 - startTime2).toBeLessThan(endTime1 - startTime1); // Кэш быстрее
    });
  });

  describe('Integration Tests', () => {
    test('should work with real quote data', async () => {
      const realQuote = await testDatabase.get('SELECT * FROM quotes WHERE id = 1');
      expect(realQuote).toBeDefined();
      
      const explanation = await aiExplainer.generateExplanation(testDatabase, realQuote);
      
      expect(explanation).toBeDefined();
      expect(explanation.length).toBeGreaterThan(50);
      expect(explanation).toContain('Purpose'); // Тематически связано
    });

    test('should integrate with favorites system', async () => {
      const quoteId = 1;
      const chatId = 12345;
      
      // Добавляем в избранное
      await testDatabase.run(
        'INSERT INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
        [chatId, quoteId, new Date().toISOString()]
      );
      
      // Генерируем объяснение
      const quote = await testDatabase.get('SELECT * FROM quotes WHERE id = ?', [quoteId]);
      const explanation = await aiExplainer.generateExplanation(testDatabase, quote);
      
      expect(explanation).toBeDefined();
      
      // Проверяем что запрос зафиксирован
      await aiExplainer.trackExplanationRequest(testDatabase, quoteId, chatId);
      
      const stats = await aiExplainer.getUsageStatistics(testDatabase);
      expect(stats.totalRequests).toBeGreaterThan(0);
    });
  });
});