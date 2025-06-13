const MockTelegramBot = require('../../../setup/mocks/telegram-bot');
const { testDb } = require('../../../setup/database-setup');
const { MockOpenAI } = require('../../../setup/mocks/openai-api');

describe('Callback Queries', () => {
  let mockBot;
  let testDatabase;
  let mockOpenAI;
  const testChatId = 12345;
  const testMessageId = 1001;

  beforeEach(async () => {
    mockBot = new MockTelegramBot('test_token');
    testDatabase = await testDb.createTestConnection(`callback_test_${Date.now()}`);
    mockOpenAI = new MockOpenAI();
    
    jest.clearAllMocks();
    mockBot.clearHistory();
    
    global.fetch = jest.fn();
    global.console.log = jest.fn();
    global.console.error = jest.fn();
  });

  afterEach(async () => {
    await testDb.closeConnection(`callback_test_${Date.now()}`);
  });

  describe('Quote Navigation Callbacks', () => {
    test('should handle "more" callback - get another quote', async () => {
      const callbackData = 'more';
      
      mockBot.simulateCallbackQuery('cb_001', callbackData, testChatId, testMessageId);
      await delay(100);

      // Проверяем что отредактированное сообщение содержит новую цитату
      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.message_id).toBe(testMessageId);
      expect(editedMessage.text).toMatch(/📖|💫/); // Эмодзи цитаты
      
      // Проверяем что callback query был отвечен
      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.callbackQueryId).toBe('cb_001');
    });

    test('should handle "more" callback with database error', async () => {
      // Симулируем ошибку БД
      const originalGet = testDatabase.get;
      testDatabase.get = jest.fn().mockRejectedValue(new Error('DB Error'));
      
      mockBot.simulateCallbackQuery('cb_002', 'more', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Ошибка загрузки цитаты');
      
      testDatabase.get = originalGet;
    });

    test('should handle "more" callback when no quotes available', async () => {
      // Очищаем все цитаты
      await testDatabase.run('DELETE FROM quotes');
      
      mockBot.simulateCallbackQuery('cb_003', 'more', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Нет доступных цитат');
    });

    test('should update reading statistics on "more" callback', async () => {
      // Получаем начальную статистику
      const userBefore = await testDatabase.get(
        'SELECT quotes_read_total FROM users WHERE chat_id = ?', [testChatId]
      );
      
      mockBot.simulateCallbackQuery('cb_004', 'more', testChatId, testMessageId);
      await delay(100);

      // Проверяем что статистика обновилась
      const userAfter = await testDatabase.get(
        'SELECT quotes_read_total FROM users WHERE chat_id = ?', [testChatId]
      );
      expect(userAfter.quotes_read_total).toBe(userBefore.quotes_read_total + 1);
    });
  });

  describe('Favorite Callbacks', () => {
    test('should add quote to favorites', async () => {
      const quoteId = 1;
      const callbackData = `fav_${quoteId}`;
      
      // Проверяем что цитата не в избранном
      const favoriteBefore = await testDatabase.get(
        'SELECT * FROM favorite_quotes WHERE chat_id = ? AND quote_id = ?',
        [testChatId, quoteId]
      );
      expect(favoriteBefore).toBeUndefined();
      
      mockBot.simulateCallbackQuery('cb_005', callbackData, testChatId, testMessageId);
      await delay(100);

      // Проверяем что цитата добавлена в избранное
      const favoriteAfter = await testDatabase.get(
        'SELECT * FROM favorite_quotes WHERE chat_id = ? AND quote_id = ?',
        [testChatId, quoteId]
      );
      expect(favoriteAfter).toBeDefined();
      expect(favoriteAfter.quote_id).toBe(quoteId);
      
      // Проверяем обновление кнопок
      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.reply_markup).toBeDefined();
      
      const buttons = editedMessage.reply_markup.inline_keyboard.flat();
      const favoriteButton = buttons.find(btn => btn.callback_data === `unfav_${quoteId}`);
      expect(favoriteButton).toBeDefined();
      expect(favoriteButton.text).toContain('❤️'); // Кнопка удаления из избранного
      
      // Проверяем callback answer
      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toContain('Добавлено в избранное');
    });

    test('should remove quote from favorites', async () => {
      const quoteId = 1;
      const callbackData = `unfav_${quoteId}`;
      
      // Добавляем цитату в избранное сначала
      await testDatabase.run(
        'INSERT INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
        [testChatId, quoteId, new Date().toISOString()]
      );
      
      mockBot.simulateCallbackQuery('cb_006', callbackData, testChatId, testMessageId);
      await delay(100);

      // Проверяем что цитата удалена из избранного
      const favorite = await testDatabase.get(
        'SELECT * FROM favorite_quotes WHERE chat_id = ? AND quote_id = ?',
        [testChatId, quoteId]
      );
      expect(favorite).toBeUndefined();
      
      // Проверяем обновление кнопок
      const editedMessage = mockBot.getLastEditedMessage();
      const buttons = editedMessage.reply_markup.inline_keyboard.flat();
      const favoriteButton = buttons.find(btn => btn.callback_data === `fav_${quoteId}`);
      expect(favoriteButton).toBeDefined();
      expect(favoriteButton.text).toContain('⭐'); // Кнопка добавления в избранное
      
      // Проверяем callback answer
      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toContain('Удалено из избранного');
    });

    test('should handle favorite callback with invalid quote ID', async () => {
      const invalidQuoteId = 99999;
      const callbackData = `fav_${invalidQuoteId}`;
      
      mockBot.simulateCallbackQuery('cb_007', callbackData, testChatId, testMessageId);
      await delay(100);

      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toContain('Цитата не найдена');
    });

    test('should handle favorite callback with database error', async () => {
      const originalRun = testDatabase.run;
      testDatabase.run = jest.fn().mockRejectedValue(new Error('DB Error'));
      
      mockBot.simulateCallbackQuery('cb_008', 'fav_1', testChatId, testMessageId);
      await delay(100);

      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toContain('Ошибка');
      
      testDatabase.run = originalRun;
    });

    test('should handle duplicate favorite addition gracefully', async () => {
      const quoteId = 1;
      
      // Добавляем цитату в избранное дважды
      await testDatabase.run(
        'INSERT INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
        [testChatId, quoteId, new Date().toISOString()]
      );
      
      mockBot.simulateCallbackQuery('cb_009', `fav_${quoteId}`, testChatId, testMessageId);
      await delay(100);

      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toContain('уже в избранном');
    });
  });

  describe('AI Explanation Callbacks', () => {
    test('should request AI explanation for quote', async () => {
      const quoteId = 1;
      const callbackData = `explain_${quoteId}`;
      
      // Настраиваем мок OpenAI
      mockOpenAI.setMockResponse('chat_completion', {
        choices: [{
          message: {
            content: 'This is a test AI explanation of the quote.'
          }
        }]
      });
      
      mockBot.simulateCallbackQuery('cb_010', callbackData, testChatId, testMessageId);
      await delay(100);

      // Проверяем что сообщение было отредактировано с объяснением
      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('🤖');
      expect(editedMessage.text).toContain('Объяснение');
      expect(editedMessage.text).toContain('test AI explanation');
      
      // Проверяем что есть кнопка "Назад"
      const buttons = editedMessage.reply_markup.inline_keyboard.flat();
      const backButton = buttons.find(btn => btn.callback_data === `back_${quoteId}`);
      expect(backButton).toBeDefined();
      
      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toContain('Генерирую объяснение');
    });

    test('should use cached explanation when available', async () => {
      const quoteId = 1;
      const cachedExplanation = 'This is a cached explanation';
      
      // Добавляем кэшированное объяснение
      await testDatabase.run(
        'INSERT OR REPLACE INTO quote_explanations (quote_id, explanation, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [quoteId, cachedExplanation, new Date().toISOString(), new Date().toISOString()]
      );
      
      mockBot.simulateCallbackQuery('cb_011', `explain_${quoteId}`, testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain(cachedExplanation);
      expect(editedMessage.text).not.toContain('Генерирую');
      
      // Проверяем что OpenAI не был вызван
      expect(mockOpenAI.getCallCount()).toBe(0);
    });

    test('should handle AI explanation error', async () => {
      const quoteId = 1;
      
      // Симулируем ошибку OpenAI
      mockOpenAI.simulateError(new Error('OpenAI API Error'));
      
      mockBot.simulateCallbackQuery('cb_012', `explain_${quoteId}`, testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Ошибка генерации объяснения');
      
      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toContain('Ошибка');
    });

    test('should handle explanation when AI explainer is disabled', async () => {
      const quoteId = 1;
      
      // Отключаем AI explainer
      await testDatabase.run(
        'UPDATE ai_explainer_status SET enabled = 0, disable_reason = ? WHERE rowid = 1',
        ['Test disable']
      );
      
      mockBot.simulateCallbackQuery('cb_013', `explain_${quoteId}`, testChatId, testMessageId);
      await delay(100);

      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toContain('временно недоступен');
    });

    test('should handle back from explanation callback', async () => {
      const quoteId = 1;
      const callbackData = `back_${quoteId}`;
      
      mockBot.simulateCallbackQuery('cb_014', callbackData, testChatId, testMessageId);
      await delay(100);

      // Проверяем что вернулись к оригинальной цитате
      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).not.toContain('Объяснение');
      expect(editedMessage.text).toMatch(/📖|💫/);
      
      // Проверяем что кнопки вернулись к исходному состоянию
      const buttons = editedMessage.reply_markup.inline_keyboard.flat();
      expect(buttons.some(btn => btn.callback_data === 'more')).toBe(true);
      expect(buttons.some(btn => btn.callback_data.startsWith('fav_'))).toBe(true);
      expect(buttons.some(btn => btn.callback_data.startsWith('explain_'))).toBe(true);
    });

    test('should save new AI explanation to cache', async () => {
      const quoteId = 2; // Цитата без кэшированного объяснения
      const aiExplanation = 'New AI generated explanation';
      
      // Настраиваем мок
      mockOpenAI.setMockResponse('chat_completion', {
        choices: [{
          message: {
            content: aiExplanation
          }
        }]
      });
      
      mockBot.simulateCallbackQuery('cb_015', `explain_${quoteId}`, testChatId, testMessageId);
      await delay(100);

      // Проверяем что объяснение сохранилось в кэш
      const cached = await testDatabase.get(
        'SELECT * FROM quote_explanations WHERE quote_id = ?', [quoteId]
      );
      expect(cached).toBeDefined();
      expect(cached.explanation).toBe(aiExplanation);
      expect(cached.created_at).toBeDefined();
      expect(cached.updated_at).toBeDefined();
    });
  });

  describe('Help Navigation Callbacks', () => {
    test('should handle help main callback', async () => {
      mockBot.simulateCallbackQuery('cb_016', 'help_main', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Помощь');
      expect(editedMessage.text).toContain('Основные команды');
      
      // Проверяем наличие кнопок навигации
      const buttons = editedMessage.reply_markup.inline_keyboard.flat();
      expect(buttons.some(btn => btn.callback_data === 'help_commands')).toBe(true);
      expect(buttons.some(btn => btn.callback_data === 'help_settings')).toBe(true);
    });

    test('should handle help commands callback', async () => {
      mockBot.simulateCallbackQuery('cb_017', 'help_commands', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Команды');
      expect(editedMessage.text).toContain('/quote');
      expect(editedMessage.text).toContain('/find');
      expect(editedMessage.text).toContain('/mystats');
      
      // Проверяем кнопку "Назад"
      const buttons = editedMessage.reply_markup.inline_keyboard.flat();
      expect(buttons.some(btn => btn.callback_data === 'help_main')).toBe(true);
    });

    test('should handle help settings callback', async () => {
      mockBot.simulateCallbackQuery('cb_018', 'help_settings', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Настройки');
      expect(editedMessage.text).toContain('/time');
      expect(editedMessage.text).toContain('/tz');
      expect(editedMessage.text).toContain('/daily');
      
      const buttons = editedMessage.reply_markup.inline_keyboard.flat();
      expect(buttons.some(btn => btn.callback_data === 'help_main')).toBe(true);
    });

    test('should handle help features callback', async () => {
      mockBot.simulateCallbackQuery('cb_019', 'help_features', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Возможности');
      expect(editedMessage.text).toContain('Избранные');
      expect(editedMessage.text).toContain('Статистика');
      expect(editedMessage.text).toContain('AI объяснения');
    });
  });

  describe('Statistics Callbacks', () => {
    test('should handle quick stats callback', async () => {
      mockBot.simulateCallbackQuery('cb_020', 'quick_stats', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('📊');
      expect(editedMessage.text).toContain('Статистика');
      expect(editedMessage.text).toContain('Прочитано');
      expect(editedMessage.text).toContain('Уровень');
      
      // Проверяем кнопку "Подробнее"
      const buttons = editedMessage.reply_markup.inline_keyboard.flat();
      expect(buttons.some(btn => btn.callback_data === 'detailed_stats')).toBe(true);
    });

    test('should handle detailed stats callback', async () => {
      mockBot.simulateCallbackQuery('cb_021', 'detailed_stats', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Подробная статистика');
      expect(editedMessage.text).toContain('Серия');
      expect(editedMessage.text).toContain('Избранных');
      expect(editedMessage.text).toContain('Достижения');
    });

    test('should handle achievements callback', async () => {
      mockBot.simulateCallbackQuery('cb_022', 'achievements', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('🏆');
      expect(editedMessage.text).toContain('Достижения');
    });
  });

  describe('Favorites Navigation Callbacks', () => {
    test('should handle random favorite callback', async () => {
      // Убеждаемся что у пользователя есть избранные
      await testDatabase.run(
        'INSERT OR REPLACE INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
        [testChatId, 1, new Date().toISOString()]
      );
      
      mockBot.simulateCallbackQuery('cb_023', 'randomfav', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('⭐');
      expect(editedMessage.text).toContain('Избранная цитата');
    });

    test('should handle favorites pagination', async () => {
      // Добавляем много избранных для тестирования пагинации
      for (let i = 1; i <= 15; i++) {
        await testDatabase.run(
          'INSERT OR REPLACE INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
          [testChatId, i % 5 + 1, new Date().toISOString()]
        );
      }
      
      mockBot.simulateCallbackQuery('cb_024', 'fav_page_2', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Страница 2');
      
      // Проверяем кнопки навигации
      const buttons = editedMessage.reply_markup.inline_keyboard.flat();
      expect(buttons.some(btn => btn.callback_data === 'fav_page_1')).toBe(true);
      expect(buttons.some(btn => btn.callback_data === 'fav_page_3')).toBe(true);
    });

    test('should handle favorite quote selection from list', async () => {
      const quoteId = 1;
      
      // Добавляем цитату в избранное
      await testDatabase.run(
        'INSERT OR REPLACE INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
        [testChatId, quoteId, new Date().toISOString()]
      );
      
      mockBot.simulateCallbackQuery('cb_025', `favquote_${quoteId}`, testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Purpose of life'); // Текст первой цитаты
      
      // Проверяем что появились стандартные кнопки цитаты
      const buttons = editedMessage.reply_markup.inline_keyboard.flat();
      expect(buttons.some(btn => btn.callback_data === 'more')).toBe(true);
      expect(buttons.some(btn => btn.callback_data === `unfav_${quoteId}`)).toBe(true);
    });
  });

  describe('Settings Callbacks', () => {
    test('should handle settings menu callback', async () => {
      mockBot.simulateCallbackQuery('cb_026', 'settings', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('⚙️');
      expect(editedMessage.text).toContain('Настройки');
      
      // Проверяем кнопки настроек
      const buttons = editedMessage.reply_markup.inline_keyboard.flat();
      expect(buttons.some(btn => btn.callback_data === 'settings_time')).toBe(true);
      expect(buttons.some(btn => btn.callback_data === 'settings_timezone')).toBe(true);
      expect(buttons.some(btn => btn.callback_data === 'settings_notifications')).toBe(true);
    });

    test('should handle notification settings callback', async () => {
      mockBot.simulateCallbackQuery('cb_027', 'settings_notifications', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Уведомления');
      
      // Проверяем текущие настройки пользователя
      const user = await testDatabase.get('SELECT * FROM users WHERE chat_id = ?', [testChatId]);
      if (user.daily_enabled) {
        expect(editedMessage.text).toContain('✅ Ежедневные');
      } else {
        expect(editedMessage.text).toContain('❌ Ежедневные');
      }
      
      const buttons = editedMessage.reply_markup.inline_keyboard.flat();
      expect(buttons.some(btn => btn.callback_data === 'toggle_daily')).toBe(true);
      expect(buttons.some(btn => btn.callback_data === 'toggle_broadcast')).toBe(true);
    });

    test('should handle toggle daily notifications', async () => {
      // Получаем текущее состояние
      const userBefore = await testDatabase.get(
        'SELECT daily_enabled FROM users WHERE chat_id = ?', [testChatId]
      );
      
      mockBot.simulateCallbackQuery('cb_028', 'toggle_daily', testChatId, testMessageId);
      await delay(100);

      // Проверяем что состояние изменилось
      const userAfter = await testDatabase.get(
        'SELECT daily_enabled FROM users WHERE chat_id = ?', [testChatId]
      );
      expect(userAfter.daily_enabled).toBe(userBefore.daily_enabled === 1 ? 0 : 1);
      
      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toMatch(/включены|отключены/);
    });

    test('should handle toggle broadcast notifications', async () => {
      const userBefore = await testDatabase.get(
        'SELECT broadcast_enabled FROM users WHERE chat_id = ?', [testChatId]
      );
      
      mockBot.simulateCallbackQuery('cb_029', 'toggle_broadcast', testChatId, testMessageId);
      await delay(100);

      const userAfter = await testDatabase.get(
        'SELECT broadcast_enabled FROM users WHERE chat_id = ?', [testChatId]
      );
      expect(userAfter.broadcast_enabled).toBe(userBefore.broadcast_enabled === 1 ? 0 : 1);
    });
  });

  describe('Admin Callbacks', () => {
    const adminChatId = 98765;

    test('should handle add admin callback', async () => {
      mockBot.simulateCallbackQuery('cb_030', 'add_admin', adminChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Добавление администратора');
      expect(editedMessage.text).toContain('Chat ID');
    });

    test('should handle remove admin callback', async () => {
      mockBot.simulateCallbackQuery('cb_031', 'remove_admin', adminChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Удаление администратора');
      
      // Должен показать список текущих админов
      expect(editedMessage.text).toContain('98765'); // ID админа
    });

    test('should handle broadcast test callback', async () => {
      const broadcastId = 1;
      
      mockBot.simulateCallbackQuery('cb_032', `test_broadcast_${broadcastId}`, adminChatId, testMessageId);
      await delay(100);

      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toContain('Тестовая рассылка отправлена');
    });

    test('should handle broadcast edit callback', async () => {
      const broadcastId = 1;
      
      mockBot.simulateCallbackQuery('cb_033', `edit_broadcast_${broadcastId}`, adminChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Редактирование рассылки');
      expect(editedMessage.text).toContain(`ID: ${broadcastId}`);
    });

    test('should restrict admin callbacks to authorized users', async () => {
      // Пытаемся выполнить админский callback от обычного пользователя
      mockBot.simulateCallbackQuery('cb_034', 'add_admin', testChatId, testMessageId);
      await delay(100);

      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toContain('У вас нет прав');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle malformed callback data', async () => {
      const malformedCallbacks = [
        'invalid_callback',
        'fav_',
        'explain_abc',
        'fav_999999',
        'back_invalid',
        '',
        null,
        undefined
      ];
      
      for (const callbackData of malformedCallbacks) {
        mockBot.clearHistory();
        mockBot.simulateCallbackQuery(`cb_${Date.now()}`, callbackData, testChatId, testMessageId);
        await delay(100);
        
        const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
        expect(callbackResponse).toBeDefined();
        expect(callbackResponse.text).toMatch(/Неизвестная команда|Ошибка|Неверный формат/);
      }
    });

    test('should handle callback queries for non-existent messages', async () => {
      const nonExistentMessageId = 99999;
      
      mockBot.simulateCallbackQuery('cb_035', 'more', testChatId, nonExistentMessageId);
      await delay(100);

      // Проверяем что callback был обработан корректно
      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse).toBeDefined();
    });

    test('should handle concurrent callback queries', async () => {
      const callbacks = [
        'more',
        'fav_1',
        'explain_1',
        'quick_stats',
        'help_main'
      ];
      
      // Отправляем несколько callback queries одновременно
      const promises = callbacks.map((data, index) => {
        mockBot.simulateCallbackQuery(`cb_concurrent_${index}`, data, testChatId, testMessageId + index);
        return delay(10);
      });
      
      await Promise.all(promises);
      await delay(200);
      
      // Проверяем что все callback queries были обработаны
      expect(mockBot.callbackQueries.length).toBeGreaterThanOrEqual(callbacks.length);
    });

    test('should handle database errors in callback processing', async () => {
      const originalGet = testDatabase.get;
      testDatabase.get = jest.fn().mockRejectedValue(new Error('Database connection lost'));
      
      mockBot.simulateCallbackQuery('cb_036', 'more', testChatId, testMessageId);
      await delay(100);

      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toContain('Ошибка');
      
      testDatabase.get = originalGet;
    });

    test('should prevent callback spam', async () => {
      // Отправляем много callback queries быстро от одного пользователя
      for (let i = 0; i < 20; i++) {
        mockBot.simulateCallbackQuery(`cb_spam_${i}`, 'more', testChatId, testMessageId);
        await delay(5);
      }
      
      await delay(100);
      
      // Проверяем что есть сообщения о превышении лимита
      const rateLimitResponses = mockBot.callbackQueries.filter(cb => 
        cb.text.includes('Слишком быстро') || cb.text.includes('Подождите')
      );
      
      expect(rateLimitResponses.length).toBeGreaterThan(0);
    });

    test('should handle callbacks with expired data', async () => {
      // Симулируем callback с данными, которые больше не актуальны
      const deletedQuoteId = 999;
      
      mockBot.simulateCallbackQuery('cb_037', `fav_${deletedQuoteId}`, testChatId, testMessageId);
      await delay(100);

      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toContain('больше не доступна');
    });
  });

  describe('User Experience and Interface', () => {
    test('should provide consistent button layouts', async () => {
      const callbacksToTest = [
        'more',
        'back_1',
        'help_main',
        'settings'
      ];
      
      for (const callbackData of callbacksToTest) {
        mockBot.clearHistory();
        mockBot.simulateCallbackQuery(`cb_ui_${Date.now()}`, callbackData, testChatId, testMessageId);
        await delay(100);
        
        const editedMessage = mockBot.getLastEditedMessage();
        expect(editedMessage.reply_markup).toBeDefined();
        expect(editedMessage.reply_markup.inline_keyboard).toBeDefined();
        expect(editedMessage.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
      }
    });

    test('should provide contextual help in error messages', async () => {
      mockBot.simulateCallbackQuery('cb_038', 'invalid_command', testChatId, testMessageId);
      await delay(100);

      const callbackResponse = mockBot.callbackQueries[mockBot.callbackQueries.length - 1];
      expect(callbackResponse.text).toBeDefined();
      expect(callbackResponse.text.length).toBeGreaterThan(0);
    });

    test('should handle long callback responses appropriately', async () => {
      // Создаем очень длинное объяснение для тестирования
      mockOpenAI.setMockResponse('chat_completion', {
        choices: [{
          message: {
            content: 'Very long explanation. '.repeat(200)
          }
        }]
      });
      
      mockBot.simulateCallbackQuery('cb_039', 'explain_1', testChatId, testMessageId);
      await delay(100);

      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text.length).toBeLessThanOrEqual(4096); // Telegram limit
    });

    test('should preserve user context across callback interactions', async () => {
      // Выполняем последовательность callback queries
      mockBot.simulateCallbackQuery('cb_040', 'explain_1', testChatId, testMessageId);
      await delay(100);
      
      mockBot.simulateCallbackQuery('cb_041', 'back_1', testChatId, testMessageId);
      await delay(100);
      
      mockBot.simulateCallbackQuery('cb_042', 'fav_1', testChatId, testMessageId);
      await delay(100);

      // Проверяем что пользователь остается в контексте той же цитаты
      const editedMessage = mockBot.getLastEditedMessage();
      expect(editedMessage.text).toContain('Purpose of life'); // Первая цитата
      
      // Проверяем что цитата добавлена в избранное
      const favorite = await testDatabase.get(
        'SELECT * FROM favorite_quotes WHERE chat_id = ? AND quote_id = 1',
        [testChatId]
      );
      expect(favorite).toBeDefined();
    });
  });

  describe('Performance and Optimization', () => {
    test('should handle high volume of callback queries efficiently', async () => {
      const startTime = Date.now();
      
      // Отправляем много callback queries
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          mockBot.simulateCallbackQuery(`cb_perf_${i}`, 'quick_stats', testChatId + i, testMessageId)
        );
      }
      
      await Promise.all(promises);
      const endTime = Date.now();
      
      // Проверяем что обработка заняла разумное время
      expect(endTime - startTime).toBeLessThan(5000); // 5 секунд максимум
    });

    test('should cache frequently accessed data', async () => {
      // Выполняем одинаковый callback несколько раз
      for (let i = 0; i < 5; i++) {
        mockBot.clearHistory();
        mockBot.simulateCallbackQuery(`cb_cache_${i}`, 'quick_stats', testChatId, testMessageId);
        await delay(50);
      }
      
      // В реальной системе это должно использовать кэш
      // Здесь проверяем что все запросы обработались успешно
      expect(mockBot.callbackQueries.length).toBe(5);
    });
  });
});