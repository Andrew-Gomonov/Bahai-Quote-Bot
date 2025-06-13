const path = require('path');
const fs = require('fs');

// Глобальные моки
global.console = {
  ...console,
  // Подавляем логи в тестах, но сохраняем для отладки
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Настройки переменных окружения для тестов
process.env.NODE_ENV = 'test';
process.env.BOT_TOKEN = 'test_bot_token';
process.env.OPENAI_API_KEY = 'test_openai_key';
process.env.ADMIN_SECRET = 'test_admin_secret';
process.env.ADMIN_USERNAME = 'test_admin';
process.env.ADMIN_PASSWORD = 'test_password';
process.env.SESSION_SECRET = 'test_session_secret';
process.env.PORT = '3001';
process.env.ADMIN_PORT = '3002';

// Функция для создания тестовой базы данных
global.createTestDb = async () => {
  const Database = require('../../src/core/db');
  const db = new Database(':memory:');
  await db.init();
  return db;
};

// Функция для очистки тестовых файлов
global.cleanupTestFiles = () => {
  const testFiles = [
    'test.db',
    'test-admin.db',
    'test-quotes.csv',
    'test-upload.jpg'
  ];
  
  testFiles.forEach(file => {
    const filePath = path.join(__dirname, '../../', file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
};

// Функция для создания тестового пользователя
global.createTestUser = (chatId = 12345) => ({
  chat_id: chatId,
  username: 'test_user',
  first_name: 'Test',
  last_name: 'User',
  timezone: 'Europe/London',
  daily_time: '09:00',
  daily_enabled: 1,
  broadcast_enabled: 1,
  joined_at: new Date().toISOString(),
  quotes_read_total: 0,
  daily_streak: 0,
  level: 1,
  experience: 0
});

// Функция для создания тестовой цитаты
global.createTestQuote = (id = 1) => ({
  id: id,
  text: 'Test quote text',
  author: 'Test Author',
  theme: 'Test Theme',
  source: 'Test Source'
});

// Функция для создания тестового админа
global.createTestAdmin = (username = 'testadmin') => ({
  username: username,
  password: '$2b$10$test.hash.password',
  role: 'admin',
  profile_picture: null,
  last_login_at: null,
  failed_attempts: 0,
  locked_until: null
});

// Таймауты для тестов
global.TEST_TIMEOUT = 30000;
global.PERFORMANCE_TIMEOUT = 60000;

// Утилиты для тестирования
global.delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

global.waitForCondition = async (condition, timeout = 5000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return true;
    }
    await delay(100);
  }
  throw new Error('Condition not met within timeout');
};

// Очистка после каждого теста
afterEach(async () => {
  // Очищаем все моки
  jest.clearAllMocks();
  
  // Очищаем тестовые файлы
  cleanupTestFiles();
  
  // Сбрасываем переменные окружения
  delete process.env.TEST_SCENARIO;
});

// Настройка перед всеми тестами
beforeAll(async () => {
  // Создаем необходимые папки для тестов
  const dirs = ['__tests__/coverage', '__tests__/reports', '__tests__/temp'];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
});

// Очистка после всех тестов
afterAll(async () => {
  // Финальная очистка
  cleanupTestFiles();
});