module.exports = {
  // Основные настройки
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],
  
  // Покрытие кода
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/admin/public/**',
    '!src/admin/views/**',
    '!**/node_modules/**'
  ],
  coverageDirectory: '__tests__/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  
  // Настройки выполнения
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup/test-setup.js'],
  testTimeout: 30000,
  maxWorkers: 4,
  
  // Моки
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  
  // Игнорируемые файлы
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/'
  ],
  
  // Трансформация
  transform: {},
  
  // Отчеты
  reporters: ['default'],
  
  // Глобальные переменные
  globals: {
    'process.env.NODE_ENV': 'test',
    'process.env.DB_PATH': ':memory:',
    'process.env.ADMIN_DB_PATH': ':memory:'
  }
};