const MockTelegramBot = require('../../../setup/mocks/telegram-bot');
const { testDb } = require('../../../setup/database-setup');
const { MockOpenAI } = require('../../../setup/mocks/openai-api');

// Импортируем модули для тестирования
const botCommands = require('../../../../src/bot/commands');
const quotes = require('../../../../src/bot/quotes');
const favorites = require('../../../../src/bot/favorites');
const stats = require('../../../../src/bot/stats');
const search = require('../../../../src/bot/search');

describe('User Commands', () => {
  let mockBot;
  let testDatabase;
  let mockOpenAI;

  beforeEach(async () => {
    // Создаем моки
    mockBot = new MockTelegramBot('test_token');
    testDatabase = await testDb.createTestConnection(`test_${Date.now()}`);
    mockOpenAI = new MockOpenAI();
    
    // Настраиваем моки
    jest.clearAllMocks();
    mockBot.clearHistory();
    
    // Мокаем глобальные зависимости
    global.fetch = jest.fn();
    global.console.log = jest.fn();
    global.console.error = jest.fn();
  });

  afterEach(async () => {
    await testDb.closeConnection(`test_${Date.now()}`);
  });

  describe('/start command', () => {
    test('should register new user successfully', async () => {
      const chatId = 99999;
      const username = 'new_user';
      
      // Симулируем команду /start
      mockBot.simulateMessage(chatId, '/start', {
        from: { id: chatId, username: username, first_name: 'New', last_name: 'User' }
      });

      // Ждем обработки
      await delay(100);

      // Проверяем отправку сообщения
      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Добро пожаловать');
      expect(sentMessage.reply_markup).toBeDefined();
      expect(sentMessage.reply_markup.inline_keyboard).toBeDefined();

      // Проверяем создание пользователя в БД
      const user = await testDatabase.get('SELECT * FROM users WHERE chat_id = ?', [chatId]);
      expect(user).toBeDefined();
      expect(user.chat_id).toBe(chatId);
      expect(user.username).toBe(username);
      expect(user.daily_enabled).toBe(1);
      expect(user.broadcast_enabled).toBe(1);
      expect(user.level).toBe(1);
      expect(user.experience).toBe(0);
    });

    test('should reactivate existing user', async () => {
      const chatId = 12345; // Существующий пользователь из тестовых данных
      
      // Получаем начальные данные пользователя
      const userBefore = await testDatabase.get('SELECT * FROM users WHERE chat_id = ?', [chatId]);
      expect(userBefore).toBeDefined();
      
      mockBot.simulateMessage(chatId, '/start');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Рад видеть вас снова');
      
      // Проверяем что пользователь не дублируется
      const userAfter = await testDatabase.get('SELECT * FROM users WHERE chat_id = ?', [chatId]);
      expect(userAfter.quotes_read_total).toBe(userBefore.quotes_read_total);
    });

    test('should handle database error gracefully', async () => {
      const chatId = 99998;
      
      // Симулируем ошибку БД
      const originalRun = testDatabase.run;
      testDatabase.run = jest.fn().mockRejectedValue(new Error('Database error'));
      
      mockBot.simulateMessage(chatId, '/start');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Произошла ошибка');
      
      // Восстанавливаем оригинальный метод
      testDatabase.run = originalRun;
    });

    test('should handle missing user data gracefully', async () => {
      const chatId = 99997;
      
      // Симулируем сообщение без данных пользователя
      mockBot.simulateMessage(chatId, '/start', {
        from: { id: chatId } // Минимальные данные
      });
      
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Добро пожаловать');
      
      // Проверяем что пользователь создался с дефолтными значениями
      const user = await testDatabase.get('SELECT * FROM users WHERE chat_id = ?', [chatId]);
      expect(user).toBeDefined();
      expect(user.username).toBeNull();
    });
  });

  describe('/quote command', () => {
    test('should return random quote', async () => {
      const chatId = 12345;
      
      mockBot.simulateMessage(chatId, '/quote');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toMatch(/📖|💫/); // Проверяем наличие эмодзи
      expect(sentMessage.reply_markup).toBeDefined();
      expect(sentMessage.reply_markup.inline_keyboard).toBeDefined();
      
      // Проверяем что кнопки присутствуют
      const buttons = sentMessage.reply_markup.inline_keyboard.flat();
      expect(buttons.some(btn => btn.callback_data === 'more')).toBe(true);
      expect(buttons.some(btn => btn.callback_data.startsWith('fav_'))).toBe(true);
    });

    test('should return specific quote by ID', async () => {
      const chatId = 12345;
      const quoteId = 1;
      
      mockBot.simulateMessage(chatId, `/quote ${quoteId}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Purpose of life'); // Проверяем конкретную цитату
    });

    test('should handle non-existent quote ID', async () => {
      const chatId = 12345;
      const nonExistentId = 999999;
      
      mockBot.simulateMessage(chatId, `/quote ${nonExistentId}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Цитата не найдена');
    });

    test('should handle invalid quote ID format', async () => {
      const chatId = 12345;
      
      mockBot.simulateMessage(chatId, '/quote abc');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Неверный формат');
    });

    test('should enforce cooldown period', async () => {
      const chatId = 12345;
      
      // Первый запрос
      mockBot.simulateMessage(chatId, '/quote');
      await delay(100);
      
      // Второй запрос сразу после первого
      mockBot.clearHistory();
      mockBot.simulateMessage(chatId, '/quote');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Подождите');
    });

    test('should handle empty database', async () => {
      // Очищаем все цитаты
      await testDatabase.run('DELETE FROM quotes');
      
      const chatId = 12345;
      mockBot.simulateMessage(chatId, '/quote');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Нет доступных цитат');
    });

    test('should track quote reading statistics', async () => {
      const chatId = 12345;
      
      // Получаем начальную статистику
      const userBefore = await testDatabase.get(
        'SELECT quotes_read_total FROM users WHERE chat_id = ?', [chatId]
      );
      
      mockBot.simulateMessage(chatId, '/quote');
      await delay(100);

      // Проверяем что статистика обновилась
      const userAfter = await testDatabase.get(
        'SELECT quotes_read_total FROM users WHERE chat_id = ?', [chatId]
      );
      expect(userAfter.quotes_read_total).toBe(userBefore.quotes_read_total + 1);
      
      // Проверяем запись в quote_reads
      const readRecord = await testDatabase.get(
        'SELECT * FROM quote_reads WHERE chat_id = ? ORDER BY read_at DESC LIMIT 1',
        [chatId]
      );
      expect(readRecord).toBeDefined();
      expect(readRecord.read_type).toBe('command');
    });
  });

  describe('/find command', () => {
    test('should find quotes by text search', async () => {
      const chatId = 12345;
      const searchTerm = 'unity';
      
      mockBot.simulateMessage(chatId, `/find ${searchTerm}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('unity');
      expect(sentMessage.text).toContain('Найдено');
    });

    test('should handle fuzzy search', async () => {
      const chatId = 12345;
      const searchTerm = 'purpos'; // Неполное слово
      
      mockBot.simulateMessage(chatId, `/find ${searchTerm}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('purpose');
    });

    test('should handle empty search query', async () => {
      const chatId = 12345;
      
      mockBot.simulateMessage(chatId, '/find');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Введите поисковый запрос');
    });

    test('should handle no results found', async () => {
      const chatId = 12345;
      const searchTerm = 'nonexistentword12345';
      
      mockBot.simulateMessage(chatId, `/find ${searchTerm}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Ничего не найдено');
    });

    test('should handle special characters in search', async () => {
      const chatId = 12345;
      const searchTerm = 'God@#$%';
      
      mockBot.simulateMessage(chatId, `/find ${searchTerm}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      // Должно обработать без ошибок
      expect(sentMessage.text).toBeDefined();
    });

    test('should limit search results', async () => {
      const chatId = 12345;
      const searchTerm = 'Bahá'; // Поиск по автору, должен найти несколько
      
      mockBot.simulateMessage(chatId, `/find ${searchTerm}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Найдено');
      
      // Проверяем что результаты ограничены
      const lines = sentMessage.text.split('\n');
      expect(lines.length).toBeLessThan(50); // Разумное ограничение
    });
  });

  describe('/mystats command', () => {
    test('should display user statistics', async () => {
      const chatId = 12345;
      
      mockBot.simulateMessage(chatId, '/mystats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('📊');
      expect(sentMessage.text).toContain('Прочитано цитат');
      expect(sentMessage.text).toContain('Уровень');
      expect(sentMessage.text).toContain('Серия');
    });

    test('should handle new user without stats', async () => {
      const chatId = 99996;
      
      // Создаем нового пользователя без статистики
      await testDb.addTestUser(testDatabase, {
        chat_id: chatId,
        quotes_read_total: 0,
        daily_streak: 0,
        level: 1,
        experience: 0
      });
      
      mockBot.simulateMessage(chatId, '/mystats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Начните читать цитаты');
    });

    test('should display achievements', async () => {
      const chatId = 12345; // У этого пользователя есть достижения
      
      mockBot.simulateMessage(chatId, '/mystats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('🏆');
      expect(sentMessage.text).toContain('Достижения');
    });
  });

  describe('/favorites command', () => {
    test('should display user favorites', async () => {
      const chatId = 12345; // У этого пользователя есть избранные
      
      mockBot.simulateMessage(chatId, '/favorites');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('⭐');
      expect(sentMessage.text).toContain('Избранные');
    });

    test('should handle empty favorites list', async () => {
      const chatId = 12347; // У этого пользователя нет избранных
      
      mockBot.simulateMessage(chatId, '/favorites');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('У вас пока нет избранных');
    });

    test('should paginate favorites', async () => {
      const chatId = 12345;
      
      // Добавляем много избранных для тестирования пагинации
      for (let i = 6; i <= 20; i++) {
        await testDatabase.run(
          'INSERT OR REPLACE INTO favorite_quotes (chat_id, quote_id, favorited_at) VALUES (?, ?, ?)',
          [chatId, i % 5 + 1, new Date().toISOString()]
        );
      }
      
      mockBot.simulateMessage(chatId, '/favorites');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.reply_markup).toBeDefined();
      
      // Проверяем наличие кнопок навигации
      const buttons = sentMessage.reply_markup.inline_keyboard.flat();
      expect(buttons.some(btn => btn.callback_data.includes('fav_page'))).toBe(true);
    });
  });

  describe('/randomfav command', () => {
    test('should return random favorite quote', async () => {
      const chatId = 12345; // У этого пользователя есть избранные
      
      mockBot.simulateMessage(chatId, '/randomfav');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('⭐');
    });

    test('should handle empty favorites', async () => {
      const chatId = 12347; // У этого пользователя нет избранных
      
      mockBot.simulateMessage(chatId, '/randomfav');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('У вас нет избранных');
    });
  });

  describe('/time command', () => {
    test('should set valid time', async () => {
      const chatId = 12345;
      const newTime = '14:30';
      
      mockBot.simulateMessage(chatId, `/time ${newTime}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Время установлено');
      expect(sentMessage.text).toContain(newTime);
      
      // Проверяем что время сохранилось в БД
      const user = await testDatabase.get(
        'SELECT daily_time FROM users WHERE chat_id = ?', [chatId]
      );
      expect(user.daily_time).toBe(newTime);
    });

    test('should reject invalid time format', async () => {
      const chatId = 12345;
      const invalidTime = '25:99';
      
      mockBot.simulateMessage(chatId, `/time ${invalidTime}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Неверный формат времени');
    });

    test('should handle edge cases', async () => {
      const chatId = 12345;
      
      // Тест граничных значений
      const testCases = [
        { time: '00:00', valid: true },
        { time: '23:59', valid: true },
        { time: '24:00', valid: false },
        { time: '12:60', valid: false },
        { time: '12', valid: false },
        { time: '12:30:45', valid: false }
      ];
      
      for (const testCase of testCases) {
        mockBot.clearHistory();
        mockBot.simulateMessage(chatId, `/time ${testCase.time}`);
        await delay(100);
        
        const sentMessage = mockBot.getLastSentMessage();
        if (testCase.valid) {
          expect(sentMessage.text).toContain('Время установлено');
        } else {
          expect(sentMessage.text).toContain('Неверный формат');
        }
      }
    });
  });

  describe('/randomtime command', () => {
    test('should set random time', async () => {
      const chatId = 12345;
      
      mockBot.simulateMessage(chatId, '/randomtime');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Случайное время установлено');
      
      // Проверяем что время изменилось в БД
      const user = await testDatabase.get(
        'SELECT daily_time FROM users WHERE chat_id = ?', [chatId]
      );
      expect(user.daily_time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/); // Валидный формат времени
    });
  });

  describe('/tz command', () => {
    test('should set valid timezone', async () => {
      const chatId = 12345;
      const newTimezone = 'America/New_York';
      
      mockBot.simulateMessage(chatId, `/tz ${newTimezone}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Часовой пояс установлен');
      
      // Проверяем что часовой пояс сохранился в БД
      const user = await testDatabase.get(
        'SELECT timezone FROM users WHERE chat_id = ?', [chatId]
      );
      expect(user.timezone).toBe(newTimezone);
    });

    test('should reject invalid timezone', async () => {
      const chatId = 12345;
      const invalidTimezone = 'Invalid/Timezone';
      
      mockBot.simulateMessage(chatId, `/tz ${invalidTimezone}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Неверный часовой пояс');
    });

    test('should handle common timezone formats', async () => {
      const chatId = 12345;
      const commonTimezones = [
        'UTC',
        'Europe/London',
        'America/New_York',
        'Asia/Tokyo',
        'Australia/Sydney'
      ];
      
      for (const timezone of commonTimezones) {
        mockBot.clearHistory();
        mockBot.simulateMessage(chatId, `/tz ${timezone}`);
        await delay(100);
        
        const sentMessage = mockBot.getLastSentMessage();
        expect(sentMessage.text).toContain('Часовой пояс установлен');
      }
    });
  });

  describe('/daily and /broadcast commands', () => {
    test('should toggle daily quotes on', async () => {
      const chatId = 12345;
      
      mockBot.simulateMessage(chatId, '/daily on');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Ежедневные цитаты включены');
      
      // Проверяем БД
      const user = await testDatabase.get(
        'SELECT daily_enabled FROM users WHERE chat_id = ?', [chatId]
      );
      expect(user.daily_enabled).toBe(1);
    });

    test('should toggle daily quotes off', async () => {
      const chatId = 12345;
      
      mockBot.simulateMessage(chatId, '/daily off');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Ежедневные цитаты отключены');
      
      // Проверяем БД
      const user = await testDatabase.get(
        'SELECT daily_enabled FROM users WHERE chat_id = ?', [chatId]
      );
      expect(user.daily_enabled).toBe(0);
    });

    test('should toggle broadcast notifications', async () => {
      const chatId = 12345;
      
      mockBot.simulateMessage(chatId, '/broadcast off');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Уведомления о рассылках отключены');
      
      // Проверяем БД
      const user = await testDatabase.get(
        'SELECT broadcast_enabled FROM users WHERE chat_id = ?', [chatId]
      );
      expect(user.broadcast_enabled).toBe(0);
    });

    test('should handle invalid toggle values', async () => {
      const chatId = 12345;
      
      mockBot.simulateMessage(chatId, '/daily invalid');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Используйте on или off');
    });
  });

  describe('/help command', () => {
    test('should display help menu', async () => {
      const chatId = 12345;
      
      mockBot.simulateMessage(chatId, '/help');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Помощь');
      expect(sentMessage.text).toContain('/quote');
      expect(sentMessage.text).toContain('/find');
      expect(sentMessage.text).toContain('/mystats');
      expect(sentMessage.reply_markup).toBeDefined();
    });

    test('should have interactive help navigation', async () => {
      const chatId = 12345;
      
      mockBot.simulateMessage(chatId, '/help');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      const buttons = sentMessage.reply_markup.inline_keyboard.flat();
      
      expect(buttons.some(btn => btn.callback_data === 'help_commands')).toBe(true);
      expect(buttons.some(btn => btn.callback_data === 'help_settings')).toBe(true);
    });
  });

  describe('/stop command', () => {
    test('should deactivate user', async () => {
      const chatId = 12345;
      
      mockBot.simulateMessage(chatId, '/stop');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Вы отписались');
      
      // Проверяем что пользователь деактивирован
      const user = await testDatabase.get(
        'SELECT daily_enabled, broadcast_enabled FROM users WHERE chat_id = ?', [chatId]
      );
      expect(user.daily_enabled).toBe(0);
      expect(user.broadcast_enabled).toBe(0);
    });

    test('should offer reactivation options', async () => {
      const chatId = 12345;
      
      mockBot.simulateMessage(chatId, '/stop');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.reply_markup).toBeDefined();
      
      const buttons = sentMessage.reply_markup.inline_keyboard.flat();
      expect(buttons.some(btn => btn.callback_data === 'reactivate')).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle database connection errors', async () => {
      const chatId = 12345;
      
      // Симулируем ошибку БД
      const originalGet = testDatabase.get;
      testDatabase.get = jest.fn().mockRejectedValue(new Error('Database connection failed'));
      
      mockBot.simulateMessage(chatId, '/mystats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(chatId);
      expect(sentMessage.text).toContain('Произошла ошибка');
      
      // Восстанавливаем оригинальный метод
      testDatabase.get = originalGet;
    });

    test('should handle invalid user input gracefully', async () => {
      const chatId = 12345;
      
      // Тестируем различные некорректные входные данные
      const invalidInputs = [
        '/quote ' + 'x'.repeat(1000), // Очень длинный ввод
        '/find ' + ''.repeat(0), // Пустой поиск
        '/time 25:99', // Неверное время
        '/tz ' + 'Invalid/Timezone/With/Too/Many/Slashes'
      ];
      
      for (const input of invalidInputs) {
        mockBot.clearHistory();
        mockBot.simulateMessage(chatId, input);
        await delay(100);
        
        const sentMessage = mockBot.getLastSentMessage();
        expect(sentMessage.chat.id).toBe(chatId);
        expect(sentMessage.text).toBeDefined();
        // Проверяем что ошибка обработана грамотно
        expect(sentMessage.text).not.toContain('undefined');
        expect(sentMessage.text).not.toContain('null');
      }
    });

    test('should handle concurrent command execution', async () => {
      const chatId = 12345;
      
      // Отправляем несколько команд одновременно
      const commands = ['/quote', '/mystats', '/favorites', '/help'];
      const promises = commands.map(cmd => {
        mockBot.simulateMessage(chatId, cmd);
        return delay(50);
      });
      
      await Promise.all(promises);
      await delay(200);
      
      // Проверяем что все команды обработались
      const allMessages = mockBot.getAllSentMessages();
      expect(allMessages.length).toBeGreaterThanOrEqual(commands.length);
      
      // Проверяем что нет ошибок в сообщениях
      allMessages.forEach(msg => {
        expect(msg.text).toBeDefined();
        expect(msg.text).not.toContain('Error');
      });
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limits on commands', async () => {
      const chatId = 12345;
      
      // Отправляем много команд быстро
      for (let i = 0; i < 10; i++) {
        mockBot.simulateMessage(chatId, '/quote');
        await delay(10);
      }
      
      await delay(100);
      
      const allMessages = mockBot.getAllSentMessages();
      const rateLimitMessages = allMessages.filter(msg => 
        msg.text.includes('Подождите') || msg.text.includes('Слишком быстро')
      );
      
      expect(rateLimitMessages.length).toBeGreaterThan(0);
    });

    test('should allow commands after cooldown period', async () => {
      const chatId = 12345;
      
      // Первая команда
      mockBot.simulateMessage(chatId, '/quote');
      await delay(100);
      
      // Ждем завершения кулдауна (симулируем)
      await delay(5000);
      
      // Вторая команда после кулдауна
      mockBot.clearHistory();
      mockBot.simulateMessage(chatId, '/quote');
      await delay(100);
      
      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).not.toContain('Подождите');
    });
  });

  describe('User Experience', () => {
    test('should provide consistent message formatting', async () => {
      const chatId = 12345;
      const commands = ['/quote', '/mystats', '/favorites', '/help'];
      
      for (const command of commands) {
        mockBot.clearHistory();
        mockBot.simulateMessage(chatId, command);
        await delay(100);
        
        const sentMessage = mockBot.getLastSentMessage();
        expect(sentMessage.text).toBeDefined();
        expect(sentMessage.text.length).toBeGreaterThan(0);
        expect(sentMessage.text).toMatch(/[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\p{Emoji_Modifier_Base}\p{Emoji_Presentation}]/u);
      }
    });

    test('should handle long messages properly', async () => {
      const chatId = 12345;
      
      // Создаем очень длинную цитату для тестирования
      await testDatabase.run(
        'INSERT OR REPLACE INTO quotes (id, text, author, theme, source) VALUES (?, ?, ?, ?, ?)',
        [999, 'Very long quote text that exceeds normal message limits. '.repeat(100), 'Test Author', 'Test', 'Test']
      );
      
      mockBot.simulateMessage(chatId, '/quote 999');
      await delay(100);
      
      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text.length).toBeLessThanOrEqual(4096); // Telegram limit
    });

    test('should maintain user context across commands', async () => {
      const chatId = 12345;
      
      // Выполняем последовательность команд
      mockBot.simulateMessage(chatId, '/quote');
      await delay(100);
      
      mockBot.simulateMessage(chatId, '/mystats');
      await delay(100);
      
      // Проверяем что статистика обновилась
      const statsMessage = mockBot.getLastSentMessage();
      expect(statsMessage.text).toContain('Прочитано цитат');
      
      // Статистика должна отражать прочитанную цитату
      const user = await testDatabase.get(
        'SELECT quotes_read_total FROM users WHERE chat_id = ?', [chatId]
      );
      expect(user.quotes_read_total).toBeGreaterThan(0);
    });
  });
});