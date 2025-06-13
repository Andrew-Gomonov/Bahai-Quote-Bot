// Простой тест для проверки Jest конфигурации
describe('Basic Configuration Test', () => {
  test('should run basic test', () => {
    expect(1 + 1).toBe(2);
  });

  test('should have Node environment', () => {
    expect(typeof process).toBe('object');
    expect(process.env.NODE_ENV).toBe('test');
  });

  test('should load correctly', () => {
    expect(jest).toBeDefined();
  });
});