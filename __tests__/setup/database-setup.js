const Database = require('../../src/core/db');
const path = require('path');
const fs = require('fs');

class TestDatabase {
  constructor() {
    this.connections = new Map();
    this.testDbPath = ':memory:';
  }

  // Создание изолированной тестовой БД для каждого теста
  async createTestConnection(testId = 'default') {
    const db = new Database(this.testDbPath);
    await db.init();
    
    // Заполняем тестовыми данными
    await this.seedTestData(db);
    
    this.connections.set(testId, db);
    return db;
  }

  // Получение существующего соединения
  getConnection(testId = 'default') {
    return this.connections.get(testId);
  }

  // Закрытие соединения
  async closeConnection(testId = 'default') {
    const db = this.connections.get(testId);
    if (db) {
      await db.close();
      this.connections.delete(testId);
    }
  }

  // Закрытие всех соединений
  async closeAllConnections() {
    for (const [testId, db] of this.connections) {
      await db.close();
    }
    this.connections.clear();
  }

  // Заполнение базы тестовыми данными
  async seedTestData(db) {
    // Тестовые цитаты
    const testQuotes = [
      {
        id: 1,
        text: 'The purpose of life is to worship God and to serve humanity.',
        author: 'Bahá\'u\'lláh',
        theme: 'Purpose of Life',
        source: 'Kitab-i-Aqdas'
      },
      {
        id: 2,
        text: 'Unity is the foundation of all progress.',
        author: 'Abdul-Baha',
        theme: 'Unity',
        source: 'Some Answered Questions'
      },
      {
        id: 3,
        text: 'Justice is the sole ruler of the Kingdom of God.',
        author: 'Bahá\'u\'lláh',
        theme: 'Justice',
        source: 'Gleanings'
      },
      {
        id: 4,
        text: 'Knowledge is like unto wings for the life of every soul.',
        author: 'Bahá\'u\'lláh',
        theme: 'Knowledge',
        source: 'Epistle to the Son of the Wolf'
      },
      {
        id: 5,
        text: 'The earth is but one country, and mankind its citizens.',
        author: 'Bahá\'u\'lláh',
        theme: 'World Unity',
        source: 'Gleanings'
      }
    ];

    for (const quote of testQuotes) {
      await db.run(`
        INSERT OR REPLACE INTO quotes (id, text, author, theme, source)
        VALUES (?, ?, ?, ?, ?)
      `, [quote.id, quote.text, quote.author, quote.theme, quote.source]);
    }

    // Тестовые пользователи
    const testUsers = [
      {
        chat_id: 12345,
        username: 'test_user_1',
        timezone: 'Europe/London',
        daily_time: '09:00',
        daily_enabled: 1,
        broadcast_enabled: 1,
        joined_at: new Date().toISOString(),
        quotes_read_total: 5,
        daily_streak: 3,
        level: 2,
        experience: 150
      },
      {
        chat_id: 12346,
        username: 'test_user_2',
        timezone: 'America/New_York',
        daily_time: '08:30',
        daily_enabled: 0,
        broadcast_enabled: 1,
        joined_at: new Date(Date.now() - 86400000).toISOString(),
        quotes_read_total: 2,
        daily_streak: 1,
        level: 1,
        experience: 50
      },
      {
        chat_id: 12347,
        username: 'test_user_inactive',
        timezone: 'Asia/Tokyo',
        daily_time: '07:00',
        daily_enabled: 1,
        broadcast_enabled: 0,
        joined_at: new Date(Date.now() - 172800000).toISOString(),
        quotes_read_total: 0,
        daily_streak: 0,
        level: 1,
        experience: 0
      }
    ];

    for (const user of testUsers) {
      await db.run(`
        INSERT OR REPLACE INTO users 
        (chat_id, username, timezone, daily_time, daily_enabled, broadcast_enabled, 
         joined_at, quotes_read_total, daily_streak, level, experience)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        user.chat_id, user.username, user.timezone, user.daily_time,
        user.daily_enabled, user.broadcast_enabled, user.joined_at,
        user.quotes_read_total, user.daily_streak, user.level, user.experience
      ]);
    }

    // Тестовые админы
    const testAdmins = [
      { chat_id: 98765, notifications_enabled: 1 },
      { chat_id: 98766, notifications_enabled: 0 }
    ];

    for (const admin of testAdmins) {
      await db.run(`
        INSERT OR REPLACE INTO admins (chat_id, notifications_enabled)
        VALUES (?, ?)
      `, [admin.chat_id, admin.notifications_enabled]);
    }

    // Тестовые веб-админы
    const testWebAdmins = [
      {
        username: 'superadmin',
        password: '$2b$10$test.super.admin.hash',
        role: 'super',
        profile_picture: null,
        last_login_at: null,
        failed_attempts: 0,
        locked_until: null
      },
      {
        username: 'admin',
        password: '$2b$10$test.admin.hash',
        role: 'admin',
        profile_picture: null,
        last_login_at: new Date().toISOString(),
        failed_attempts: 0,
        locked_until: null
      },
      {
        username: 'guest',
        password: '$2b$10$test.guest.hash',
        role: 'guest',
        profile_picture: null,
        last_login_at: null,
        failed_attempts: 2,
        locked_until: null
      }
    ];

    for (const webAdmin of testWebAdmins) {
      await db.run(`
        INSERT OR REPLACE INTO web_admins 
        (username, password, role, profile_picture, last_login_at, failed_attempts, locked_until)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        webAdmin.username, webAdmin.password, webAdmin.role,
        webAdmin.profile_picture, webAdmin.last_login_at,
        webAdmin.failed_attempts, webAdmin.locked_until
      ]);
    }

    // Тестовые трансляции
    const testBroadcasts = [
      {
        id: 1,
        type: 'push',
        schedule: new Date(Date.now() + 3600000).toISOString(), // +1 час
        message: 'Test push broadcast',
        image: null,
        use_gpt: 0,
        gpt_prompt: null,
        sent: 0,
        last_sent_date: null
      },
      {
        id: 2,
        type: 'weekly',
        schedule: '1 09:00', // Понедельник 09:00
        message: 'Test weekly broadcast',
        image: null,
        use_gpt: 1,
        gpt_prompt: 'Make this message inspiring',
        sent: 0,
        last_sent_date: null
      },
      {
        id: 3,
        type: 'daily',
        schedule: '09:00',
        message: 'Daily inspiration',
        image: null,
        use_gpt: 0,
        gpt_prompt: null,
        sent: 1,
        last_sent_date: new Date().toISOString()
      }
    ];

    for (const broadcast of testBroadcasts) {
      await db.run(`
        INSERT OR REPLACE INTO broadcasts 
        (id, type, schedule, message, image, use_gpt, gpt_prompt, sent, last_sent_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        broadcast.id, broadcast.type, broadcast.schedule, broadcast.message,
        broadcast.image, broadcast.use_gpt, broadcast.gpt_prompt,
        broadcast.sent, broadcast.last_sent_date
      ]);
    }

    // Тестовые избранные цитаты
    const testFavorites = [
      { chat_id: 12345, quote_id: 1, favorited_at: new Date().toISOString() },
      { chat_id: 12345, quote_id: 3, favorited_at: new Date(Date.now() - 3600000).toISOString() },
      { chat_id: 12346, quote_id: 2, favorited_at: new Date().toISOString() }
    ];

    for (const favorite of testFavorites) {
      await db.run(`
        INSERT OR REPLACE INTO favorite_quotes (chat_id, quote_id, favorited_at)
        VALUES (?, ?, ?)
      `, [favorite.chat_id, favorite.quote_id, favorite.favorited_at]);
    }

    // Тестовые прочтения цитат
    const testReads = [
      { chat_id: 12345, quote_id: 1, read_at: new Date().toISOString(), read_type: 'daily' },
      { chat_id: 12345, quote_id: 2, read_at: new Date(Date.now() - 3600000).toISOString(), read_type: 'command' },
      { chat_id: 12346, quote_id: 1, read_at: new Date().toISOString(), read_type: 'random' }
    ];

    for (const read of testReads) {
      await db.run(`
        INSERT OR REPLACE INTO quote_reads (chat_id, quote_id, read_at, read_type)
        VALUES (?, ?, ?, ?)
      `, [read.chat_id, read.quote_id, read.read_at, read.read_type]);
    }

    // Тестовые достижения
    const testAchievements = [
      {
        chat_id: 12345,
        achievement_type: 'reading',
        achievement_name: 'First Quote',
        achieved_at: new Date().toISOString(),
        value: 1
      },
      {
        chat_id: 12345,
        achievement_type: 'streak',
        achievement_name: '3 Day Streak',
        achieved_at: new Date().toISOString(),
        value: 3
      }
    ];

    for (const achievement of testAchievements) {
      await db.run(`
        INSERT OR REPLACE INTO user_achievements 
        (chat_id, achievement_type, achievement_name, achieved_at, value)
        VALUES (?, ?, ?, ?, ?)
      `, [
        achievement.chat_id, achievement.achievement_type,
        achievement.achievement_name, achievement.achieved_at, achievement.value
      ]);
    }

    // Настройки AI Explainer
    await db.run(`
      INSERT OR REPLACE INTO ai_explainer_status 
      (enabled, disabled_at, enabled_at, disable_reason)
      VALUES (?, ?, ?, ?)
    `, [1, null, new Date().toISOString(), null]);

    // Тестовые объяснения
    const testExplanations = [
      {
        quote_id: 1,
        explanation: 'This quote emphasizes the dual nature of human existence: our spiritual relationship with God and our social responsibility to humanity.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        quote_id: 2,
        explanation: 'Unity is presented here as the foundational principle for all advancement and development in human society.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ];

    for (const explanation of testExplanations) {
      await db.run(`
        INSERT OR REPLACE INTO quote_explanations 
        (quote_id, explanation, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `, [
        explanation.quote_id, explanation.explanation,
        explanation.created_at, explanation.updated_at
      ]);
    }
  }

  // Очистка всех данных
  async clearAllData(db) {
    const tables = [
      'users', 'quotes', 'admins', 'web_admins', 'broadcasts',
      'favorite_quotes', 'quote_reads', 'user_achievements',
      'quote_explanations', 'ai_explainer_status', 'login_attempts',
      'active_sessions'
    ];

    for (const table of tables) {
      await db.run(`DELETE FROM ${table}`);
    }
  }

  // Утилиты для создания тестовых данных
  async addTestUser(db, userData = {}) {
    const defaultUser = createTestUser();
    const user = { ...defaultUser, ...userData };
    
    await db.run(`
      INSERT OR REPLACE INTO users 
      (chat_id, username, timezone, daily_time, daily_enabled, broadcast_enabled, 
       joined_at, quotes_read_total, daily_streak, level, experience)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      user.chat_id, user.username, user.timezone, user.daily_time,
      user.daily_enabled, user.broadcast_enabled, user.joined_at,
      user.quotes_read_total, user.daily_streak, user.level, user.experience
    ]);

    return user;
  }

  async addTestQuote(db, quoteData = {}) {
    const defaultQuote = createTestQuote();
    const quote = { ...defaultQuote, ...quoteData };
    
    await db.run(`
      INSERT OR REPLACE INTO quotes (id, text, author, theme, source)
      VALUES (?, ?, ?, ?, ?)
    `, [quote.id, quote.text, quote.author, quote.theme, quote.source]);

    return quote;
  }

  async addTestAdmin(db, adminData = {}) {
    const defaultAdmin = createTestAdmin();
    const admin = { ...defaultAdmin, ...adminData };
    
    await db.run(`
      INSERT OR REPLACE INTO web_admins 
      (username, password, role, profile_picture, last_login_at, failed_attempts, locked_until)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      admin.username, admin.password, admin.role,
      admin.profile_picture, admin.last_login_at,
      admin.failed_attempts, admin.locked_until
    ]);

    return admin;
  }

  // Проверки состояния БД для тестов
  async getUserCount(db) {
    const result = await db.get('SELECT COUNT(*) as count FROM users');
    return result.count;
  }

  async getQuoteCount(db) {
    const result = await db.get('SELECT COUNT(*) as count FROM quotes');
    return result.count;
  }

  async getBroadcastCount(db) {
    const result = await db.get('SELECT COUNT(*) as count FROM broadcasts');
    return result.count;
  }

  async getFavoriteCount(db, chatId) {
    const result = await db.get(
      'SELECT COUNT(*) as count FROM favorite_quotes WHERE chat_id = ?',
      [chatId]
    );
    return result.count;
  }
}

// Глобальный экземпляр для использования в тестах
const testDb = new TestDatabase();

module.exports = {
  TestDatabase,
  testDb
};