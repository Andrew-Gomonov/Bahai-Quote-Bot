module.exports = {
  // Основные настройки
  testEnvironment: 'node',
  roots: ['<rootDir>/../'],
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
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  
  // Настройки выполнения
  setupFilesAfterEnv: ['<rootDir>/setup/test-setup.js'],
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
  reporters: [
    'default',
    ['jest-html-reporters', {
      publicPath: '__tests__/reports',
      filename: 'report.html',
      expand: true
    }]
  ],
  
  // Глобальные переменные
  globals: {
    'process.env.NODE_ENV': 'test',
    'process.env.DB_PATH': ':memory:',
    'process.env.ADMIN_DB_PATH': ':memory:'
  }
};