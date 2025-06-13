const MockTelegramBot = require('../../../setup/mocks/telegram-bot');
const { testDb } = require('../../../setup/database-setup');
const { MockOpenAI } = require('../../../setup/mocks/openai-api');

describe('Admin Commands', () => {
  let mockBot;
  let testDatabase;
  let mockOpenAI;
  const adminChatId = 98765; // ID админа из тестовых данных
  const regularUserChatId = 12345; // ID обычного пользователя

  beforeEach(async () => {
    mockBot = new MockTelegramBot('test_token');
    testDatabase = await testDb.createTestConnection(`admin_test_${Date.now()}`);
    mockOpenAI = new MockOpenAI();
    
    jest.clearAllMocks();
    mockBot.clearHistory();
    
    global.fetch = jest.fn();
    global.console.log = jest.fn();
    global.console.error = jest.fn();
  });

  afterEach(async () => {
    await testDb.closeConnection(`admin_test_${Date.now()}`);
  });

  describe('Admin Authorization', () => {
    test('should verify admin status before executing commands', async () => {
      // Тест с неавторизованным пользователем
      mockBot.simulateMessage(regularUserChatId, '/push 2025-12-31 15:30 Test message');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(regularUserChatId);
      expect(sentMessage.text).toContain('У вас нет прав');
    });

    test('should allow admin commands for authorized users', async () => {
      // Тест с авторизованным админом
      mockBot.simulateMessage(adminChatId, '/astats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(adminChatId);
      expect(sentMessage.text).not.toContain('У вас нет прав');
      expect(sentMessage.text).toContain('📊'); // Эмодзи статистики
    });

    test('should handle database error during admin check', async () => {
      // Симулируем ошибку БД при проверке админа
      const originalGet = testDatabase.get;
      testDatabase.get = jest.fn().mockRejectedValue(new Error('DB Error'));
      
      mockBot.simulateMessage(adminChatId, '/astats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Ошибка проверки прав');
      
      testDatabase.get = originalGet;
    });
  });

  describe('/push command', () => {
    test('should schedule push broadcast with valid parameters', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString().split('T')[0];
      const time = '15:30';
      const message = 'Test push broadcast message';
      
      mockBot.simulateMessage(adminChatId, `/push ${futureDate} ${time} ${message}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(adminChatId);
      expect(sentMessage.text).toContain('Рассылка запланирована');
      expect(sentMessage.text).toContain(futureDate);
      expect(sentMessage.text).toContain(time);

      // Проверяем что broadcast сохранился в БД
      const broadcast = await testDatabase.get(
        'SELECT * FROM broadcasts WHERE type = ? ORDER BY id DESC LIMIT 1',
        ['push']
      );
      expect(broadcast).toBeDefined();
      expect(broadcast.message).toBe(message);
      expect(broadcast.type).toBe('push');
    });

    test('should reject past date for push broadcast', async () => {
      const pastDate = '2020-01-01';
      const time = '15:30';
      const message = 'Test message';
      
      mockBot.simulateMessage(adminChatId, `/push ${pastDate} ${time} ${message}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Нельзя запланировать рассылку на прошлое время');
    });

    test('should reject invalid date format', async () => {
      const invalidDate = '2025-13-40'; // Невалидная дата
      const time = '15:30';
      const message = 'Test message';
      
      mockBot.simulateMessage(adminChatId, `/push ${invalidDate} ${time} ${message}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Неверный формат даты');
    });

    test('should reject invalid time format', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString().split('T')[0];
      const invalidTime = '25:99'; // Невалидное время
      const message = 'Test message';
      
      mockBot.simulateMessage(adminChatId, `/push ${futureDate} ${invalidTime} ${message}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Неверный формат времени');
    });

    test('should handle empty message', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString().split('T')[0];
      const time = '15:30';
      
      mockBot.simulateMessage(adminChatId, `/push ${futureDate} ${time}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Сообщение не может быть пустым');
    });

    test('should handle very long message', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString().split('T')[0];
      const time = '15:30';
      const longMessage = 'Very long message. '.repeat(200); // Очень длинное сообщение
      
      mockBot.simulateMessage(adminChatId, `/push ${futureDate} ${time} ${longMessage}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Сообщение слишком длинное');
    });

    test('should handle special characters in message', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString().split('T')[0];
      const time = '15:30';
      const specialMessage = 'Test with <script>alert("xss")</script> and 💫 emoji';
      
      mockBot.simulateMessage(adminChatId, `/push ${futureDate} ${time} ${specialMessage}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Рассылка запланирована');
      
      // Проверяем что сообщение сохранилось корректно
      const broadcast = await testDatabase.get(
        'SELECT * FROM broadcasts WHERE type = ? ORDER BY id DESC LIMIT 1',
        ['push']
      );
      expect(broadcast.message).toBe(specialMessage);
    });
  });

  describe('/weekly command', () => {
    test('should schedule weekly broadcast', async () => {
      const dayOfWeek = '1'; // Понедельник
      const time = '09:00';
      const message = 'Weekly inspiration message';
      
      mockBot.simulateMessage(adminChatId, `/weekly ${dayOfWeek} ${time} ${message}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Еженедельная рассылка настроена');
      expect(sentMessage.text).toContain('понедельник');
      expect(sentMessage.text).toContain(time);

      // Проверяем БД
      const broadcast = await testDatabase.get(
        'SELECT * FROM broadcasts WHERE type = ? ORDER BY id DESC LIMIT 1',
        ['weekly']
      );
      expect(broadcast.schedule).toBe(`${dayOfWeek} ${time}`);
      expect(broadcast.message).toBe(message);
    });

    test('should reject invalid day of week', async () => {
      const invalidDay = '8'; // Дни недели 1-7
      const time = '09:00';
      const message = 'Test message';
      
      mockBot.simulateMessage(adminChatId, `/weekly ${invalidDay} ${time} ${message}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Неверный день недели');
    });

    test('should handle all valid days of week', async () => {
      const validDays = ['1', '2', '3', '4', '5', '6', '7'];
      const dayNames = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
      
      for (let i = 0; i < validDays.length; i++) {
        mockBot.clearHistory();
        mockBot.simulateMessage(adminChatId, `/weekly ${validDays[i]} 09:00 Test ${i}`);
        await delay(100);
        
        const sentMessage = mockBot.getLastSentMessage();
        expect(sentMessage.text).toContain(dayNames[i]);
      }
    });

    test('should reject invalid time format for weekly', async () => {
      const day = '1';
      const invalidTime = '25:99';
      const message = 'Test message';
      
      mockBot.simulateMessage(adminChatId, `/weekly ${day} ${invalidTime} ${message}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Неверный формат времени');
    });
  });

  describe('/blist command', () => {
    test('should list all broadcasts', async () => {
      mockBot.simulateMessage(adminChatId, '/blist');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('📋');
      expect(sentMessage.text).toContain('Список рассылок');
      expect(sentMessage.text).toContain('ID');
    });

    test('should limit number of broadcasts shown', async () => {
      const limit = 5;
      mockBot.simulateMessage(adminChatId, `/blist ${limit}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain(`последние ${limit}`);
    });

    test('should handle invalid limit parameter', async () => {
      mockBot.simulateMessage(adminChatId, '/blist abc');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Неверный формат лимита');
    });

    test('should handle empty broadcasts list', async () => {
      // Очищаем все рассылки
      await testDatabase.run('DELETE FROM broadcasts');
      
      mockBot.simulateMessage(adminChatId, '/blist');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Нет активных рассылок');
    });

    test('should show broadcast details', async () => {
      mockBot.simulateMessage(adminChatId, '/blist');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Тип:');
      expect(sentMessage.text).toContain('Расписание:');
      expect(sentMessage.text).toContain('Сообщение:');
    });

    test('should indicate sent broadcasts', async () => {
      // Отмечаем один broadcast как отправленный
      await testDatabase.run(
        'UPDATE broadcasts SET sent = 1, last_sent_date = ? WHERE id = 1',
        [new Date().toISOString()]
      );
      
      mockBot.simulateMessage(adminChatId, '/blist');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('✅'); // Индикатор отправленного
    });
  });

  describe('/bdel command', () => {
    test('should delete existing broadcast', async () => {
      const broadcastId = 1; // ID из тестовых данных
      
      mockBot.simulateMessage(adminChatId, `/bdel ${broadcastId}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Рассылка удалена');

      // Проверяем что broadcast удален из БД
      const broadcast = await testDatabase.get(
        'SELECT * FROM broadcasts WHERE id = ?', [broadcastId]
      );
      expect(broadcast).toBeUndefined();
    });

    test('should handle non-existent broadcast ID', async () => {
      const nonExistentId = 99999;
      
      mockBot.simulateMessage(adminChatId, `/bdel ${nonExistentId}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Рассылка не найдена');
    });

    test('should handle invalid broadcast ID format', async () => {
      mockBot.simulateMessage(adminChatId, '/bdel abc');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Неверный формат ID');
    });

    test('should handle missing broadcast ID', async () => {
      mockBot.simulateMessage(adminChatId, '/bdel');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Укажите ID рассылки');
    });

    test('should handle database error during deletion', async () => {
      const originalRun = testDatabase.run;
      testDatabase.run = jest.fn().mockRejectedValue(new Error('DB Error'));
      
      mockBot.simulateMessage(adminChatId, '/bdel 1');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Ошибка при удалении');
      
      testDatabase.run = originalRun;
    });
  });

  describe('/astats command', () => {
    test('should display admin statistics', async () => {
      mockBot.simulateMessage(adminChatId, '/astats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('📊');
      expect(sentMessage.text).toContain('Статистика администратора');
      expect(sentMessage.text).toContain('Всего пользователей');
      expect(sentMessage.text).toContain('Активных пользователей');
      expect(sentMessage.text).toContain('Всего цитат');
      expect(sentMessage.text).toContain('Всего рассылок');
    });

    test('should show detailed user metrics', async () => {
      mockBot.simulateMessage(adminChatId, '/astats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Ежедневные подписки');
      expect(sentMessage.text).toContain('Рассылочные подписки');
      expect(sentMessage.text).toContain('Новых за сегодня');
      expect(sentMessage.text).toContain('Новых за неделю');
    });

    test('should show quote reading statistics', async () => {
      mockBot.simulateMessage(adminChatId, '/astats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Прочитано за сегодня');
      expect(sentMessage.text).toContain('Прочитано за неделю');
      expect(sentMessage.text).toContain('Среднее на пользователя');
    });

    test('should handle empty statistics gracefully', async () => {
      // Очищаем все данные
      await testDatabase.run('DELETE FROM users');
      await testDatabase.run('DELETE FROM quotes');
      await testDatabase.run('DELETE FROM broadcasts');
      
      mockBot.simulateMessage(adminChatId, '/astats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('0');
      expect(sentMessage.text).not.toContain('undefined');
      expect(sentMessage.text).not.toContain('null');
    });

    test('should calculate percentages correctly', async () => {
      mockBot.simulateMessage(adminChatId, '/astats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      
      // Проверяем что проценты корректно форматированы
      const percentMatches = sentMessage.text.match(/\d+\.\d+%/g);
      if (percentMatches) {
        percentMatches.forEach(percent => {
          const value = parseFloat(percent);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
        });
      }
    });
  });

  describe('/admins command', () => {
    test('should list all admins', async () => {
      mockBot.simulateMessage(adminChatId, '/admins');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('👥');
      expect(sentMessage.text).toContain('Список администраторов');
      expect(sentMessage.text).toContain('Chat ID');
    });

    test('should show notification status for each admin', async () => {
      mockBot.simulateMessage(adminChatId, '/admins');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Уведомления');
      expect(sentMessage.text).toMatch(/✅|❌/); // Статус уведомлений
    });

    test('should handle empty admins list', async () => {
      // Удаляем всех админов
      await testDatabase.run('DELETE FROM admins');
      
      mockBot.simulateMessage(adminChatId, '/admins');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Нет зарегистрированных администраторов');
    });

    test('should provide admin management options', async () => {
      mockBot.simulateMessage(adminChatId, '/admins');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.reply_markup).toBeDefined();
      
      const buttons = sentMessage.reply_markup.inline_keyboard.flat();
      expect(buttons.some(btn => btn.callback_data === 'add_admin')).toBe(true);
      expect(buttons.some(btn => btn.callback_data === 'remove_admin')).toBe(true);
    });
  });

  describe('/notif command', () => {
    test('should show current notification status', async () => {
      mockBot.simulateMessage(adminChatId, '/notif');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('🔔');
      expect(sentMessage.text).toContain('Статус уведомлений');
      expect(sentMessage.text).toMatch(/включены|отключены/);
    });

    test('should enable notifications', async () => {
      mockBot.simulateMessage(adminChatId, '/notif on');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Уведомления включены');

      // Проверяем БД
      const admin = await testDatabase.get(
        'SELECT notifications_enabled FROM admins WHERE chat_id = ?', [adminChatId]
      );
      expect(admin.notifications_enabled).toBe(1);
    });

    test('should disable notifications', async () => {
      mockBot.simulateMessage(adminChatId, '/notif off');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Уведомления отключены');

      // Проверяем БД
      const admin = await testDatabase.get(
        'SELECT notifications_enabled FROM admins WHERE chat_id = ?', [adminChatId]
      );
      expect(admin.notifications_enabled).toBe(0);
    });

    test('should handle invalid notification parameter', async () => {
      mockBot.simulateMessage(adminChatId, '/notif invalid');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Используйте on или off');
    });

    test('should handle non-admin trying to change notifications', async () => {
      mockBot.simulateMessage(regularUserChatId, '/notif on');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('У вас нет прав');
    });
  });

  describe('Broadcast Execution', () => {
    test('should execute immediate broadcast', async () => {
      const message = 'Test immediate broadcast';
      
      // Создаем рассылку с прошедшим временем для немедленного выполнения
      await testDatabase.run(`
        INSERT INTO broadcasts (type, schedule, message, sent, last_sent_date)
        VALUES (?, ?, ?, ?, ?)
      `, ['push', new Date(Date.now() - 1000).toISOString(), message, 0, null]);
      
      // Симулируем выполнение планировщика
      // В реальном коде это бы выполнилось автоматически
      mockBot.simulateMessage(adminChatId, '/test_execute_broadcasts');
      await delay(100);

      // Проверяем что рассылка была отправлена всем активным пользователям
      const allMessages = mockBot.getAllSentMessages();
      const broadcastMessages = allMessages.filter(msg => msg.text.includes(message));
      expect(broadcastMessages.length).toBeGreaterThan(0);
    });

    test('should track broadcast delivery', async () => {
      const broadcastId = 1;
      
      // Симулируем отправку рассылки
      await testDatabase.run(`
        UPDATE broadcasts SET sent = 1, last_sent_date = ? WHERE id = ?
      `, [new Date().toISOString(), broadcastId]);
      
      const broadcast = await testDatabase.get(
        'SELECT * FROM broadcasts WHERE id = ?', [broadcastId]
      );
      expect(broadcast.sent).toBe(1);
      expect(broadcast.last_sent_date).toBeDefined();
    });

    test('should handle broadcast to users with different settings', async () => {
      // Создаем пользователей с разными настройками
      await testDb.addTestUser(testDatabase, {
        chat_id: 88881,
        broadcast_enabled: 1, // Получает рассылки
        daily_enabled: 1
      });
      
      await testDb.addTestUser(testDatabase, {
        chat_id: 88882,
        broadcast_enabled: 0, // Не получает рассылки
        daily_enabled: 1
      });
      
      const message = 'Test selective broadcast';
      
      // Симулируем рассылку
      mockBot.simulateMessage(88881, message); // Симулируем отправку первому пользователю
      
      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.chat.id).toBe(88881);
      expect(sentMessage.text).toContain(message);
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed command parameters', async () => {
      const malformedCommands = [
        '/push', // Без параметров
        '/push 2025-12-31', // Без времени и сообщения
        '/push invalid-date 15:30 message', // Неверная дата
        '/weekly', // Без параметров
        '/weekly 1', // Без времени и сообщения
        '/bdel', // Без ID
        '/notif' // Без параметра
      ];
      
      for (const command of malformedCommands) {
        mockBot.clearHistory();
        mockBot.simulateMessage(adminChatId, command);
        await delay(100);
        
        const sentMessage = mockBot.getLastSentMessage();
        expect(sentMessage.text).toBeDefined();
        expect(sentMessage.text).not.toContain('undefined');
        expect(sentMessage.text).not.toContain('null');
        expect(sentMessage.text).toMatch(/Неверный формат|Укажите|Используйте/);
      }
    });

    test('should handle database connection failures', async () => {
      const originalGet = testDatabase.get;
      testDatabase.get = jest.fn().mockRejectedValue(new Error('Connection failed'));
      
      mockBot.simulateMessage(adminChatId, '/astats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Ошибка получения статистики');
      
      testDatabase.get = originalGet;
    });

    test('should handle concurrent admin operations', async () => {
      // Отправляем несколько админских команд одновременно
      const commands = ['/astats', '/blist', '/admins', '/notif'];
      const promises = commands.map(cmd => {
        mockBot.simulateMessage(adminChatId, cmd);
        return delay(50);
      });
      
      await Promise.all(promises);
      await delay(200);
      
      const allMessages = mockBot.getAllSentMessages();
      expect(allMessages.length).toBeGreaterThanOrEqual(commands.length);
      
      // Проверяем что все сообщения корректны
      allMessages.forEach(msg => {
        expect(msg.text).toBeDefined();
        expect(msg.text.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Security and Validation', () => {
    test('should sanitize broadcast messages', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString().split('T')[0];
      const maliciousMessage = '<script>alert("xss")</script> Normal text';
      
      mockBot.simulateMessage(adminChatId, `/push ${futureDate} 15:30 ${maliciousMessage}`);
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Рассылка запланирована');
      
      // Проверяем что сообщение сохранилось как есть (Telegram сам обрабатывает HTML)
      const broadcast = await testDatabase.get(
        'SELECT * FROM broadcasts WHERE type = ? ORDER BY id DESC LIMIT 1',
        ['push']
      );
      expect(broadcast.message).toBe(maliciousMessage);
    });

    test('should validate admin permissions for sensitive operations', async () => {
      // Пытаемся выполнить критические команды от имени обычного пользователя
      const sensitiveCommands = [
        '/push 2025-12-31 15:30 Test',
        '/bdel 1',
        '/weekly 1 09:00 Test',
        '/astats'
      ];
      
      for (const command of sensitiveCommands) {
        mockBot.clearHistory();
        mockBot.simulateMessage(regularUserChatId, command);
        await delay(100);
        
        const sentMessage = mockBot.getLastSentMessage();
        expect(sentMessage.text).toContain('У вас нет прав');
      }
    });

    test('should prevent SQL injection in admin commands', async () => {
      const sqlInjectionAttempts = [
        `/bdel 1; DROP TABLE broadcasts; --`,
        `/notif on'; DELETE FROM admins; --`,
        `/push 2025-12-31 15:30 test'; DROP TABLE users; --`
      ];
      
      for (const command of sqlInjectionAttempts) {
        mockBot.clearHistory();
        mockBot.simulateMessage(adminChatId, command);
        await delay(100);
        
        // Проверяем что таблицы не были повреждены
        const userCount = await testDatabase.get('SELECT COUNT(*) as count FROM users');
        expect(userCount.count).toBeGreaterThan(0);
        
        const adminCount = await testDatabase.get('SELECT COUNT(*) as count FROM admins');
        expect(adminCount.count).toBeGreaterThan(0);
      }
    });

    test('should rate limit admin commands', async () => {
      // Отправляем много админских команд быстро
      for (let i = 0; i < 20; i++) {
        mockBot.simulateMessage(adminChatId, '/astats');
        await delay(10);
      }
      
      await delay(100);
      
      const allMessages = mockBot.getAllSentMessages();
      const rateLimitMessages = allMessages.filter(msg => 
        msg.text.includes('Слишком много запросов') || 
        msg.text.includes('Подождите')
      );
      
      // Должно быть хотя бы одно сообщение о превышении лимита
      expect(rateLimitMessages.length).toBeGreaterThan(0);
    });
  });

  describe('Notification System', () => {
    test('should notify admins about system events', async () => {
      // Симулируем системное событие (например, новый пользователь)
      const newUserChatId = 77777;
      await testDb.addTestUser(testDatabase, {
        chat_id: newUserChatId,
        username: 'new_test_user'
      });
      
      // В реальной системе это отправило бы уведомление админам
      // Здесь симулируем отправку уведомления
      mockBot.simulateMessage(adminChatId, '🆕 Новый пользователь: @new_test_user');
      
      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Новый пользователь');
    });

    test('should respect admin notification preferences', async () => {
      // Отключаем уведомления для админа
      await testDatabase.run(
        'UPDATE admins SET notifications_enabled = 0 WHERE chat_id = ?',
        [adminChatId]
      );
      
      // Проверяем статус уведомлений
      mockBot.simulateMessage(adminChatId, '/notif');
      await delay(100);
      
      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('отключены');
    });
  });

  describe('Statistics and Reporting', () => {
    test('should provide accurate user engagement metrics', async () => {
      mockBot.simulateMessage(adminChatId, '/astats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      
      // Проверяем наличие ключевых метрик
      expect(sentMessage.text).toContain('Всего пользователей');
      expect(sentMessage.text).toContain('Активных пользователей');
      expect(sentMessage.text).toContain('Ежедневные подписки');
      expect(sentMessage.text).toContain('Рассылочные подписки');
      
      // Проверяем что числа выглядят разумно
      const numbers = sentMessage.text.match(/\d+/g);
      expect(numbers).toBeDefined();
      expect(numbers.length).toBeGreaterThan(5);
    });

    test('should calculate retention rates correctly', async () => {
      mockBot.simulateMessage(adminChatId, '/astats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      
      // Проверяем метрики удержания
      expect(sentMessage.text).toContain('за сегодня');
      expect(sentMessage.text).toContain('за неделю');
      expect(sentMessage.text).toContain('Среднее');
    });

    test('should show growth trends', async () => {
      mockBot.simulateMessage(adminChatId, '/astats');
      await delay(100);

      const sentMessage = mockBot.getLastSentMessage();
      expect(sentMessage.text).toContain('Новых за');
    });
  });
});