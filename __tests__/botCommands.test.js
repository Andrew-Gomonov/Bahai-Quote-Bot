const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');

// Mock TelegramBot
const handlers = [];
const mockBot = {
  onText: (regex, cb) => handlers.push({ type: 'text', regex, cb }),
  on: jest.fn(),
  sendMessage: jest.fn().mockResolvedValue(true),
  answerCallbackQuery: jest.fn(),
  stopPolling: jest.fn(),
};

jest.mock('node-telegram-bot-api', () => {
  return jest.fn().mockImplementation(() => mockBot);
});

// Silence console logs during tests
jest.spyOn(console, 'log').mockImplementation(() => {});

// Prevent real process.exit during tests
const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

describe('Bot command flow', () => {
  beforeAll(async () => {
    process.env.BOT_TOKEN = 'TEST';
    process.env.DB_PATH = path.join(__dirname, 'test.db');

    // lazy load bot after mocks & env ready
    require('../src/index');

    // wait a tick for initDatabase to finish
    await new Promise((r) => setTimeout(r, 100));

    // insert one quote if none
    const db = new sqlite3.Database(process.env.DB_PATH);
    await new Promise((res, rej) => {
      db.run('INSERT OR IGNORE INTO quotes(text) VALUES ("Test quote 1")', (e) => {
        if (e) return rej(e);
        db.close(res);
      });
    });
  });

  afterAll(async () => {
    // give any pending I/O a moment to finish and then remove test DB
    await new Promise((r) => setTimeout(r, 100));
    try {
      fs.rmSync(process.env.DB_PATH, { force: true });
    } catch {}
    exitSpy.mockRestore();
  });

  beforeEach(() => {
    mockBot.sendMessage.mockClear();
  });

  test('handles /start command', async () => {
    // find /start handler
    const h = handlers.find((h) => h.regex.source.includes('\\/start'));
    expect(h).toBeDefined();
    await h.cb({ chat: { id: 1 }, text: '/start' }, null);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockBot.sendMessage).toHaveBeenCalled();
  });

  test('handles /quote command', async () => {
    const h = handlers.find((h) => h.regex.source.startsWith('\\/quote'));
    expect(h).toBeDefined();
    await h.cb({ chat: { id: 1 }, text: '/quote' }, []);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockBot.sendMessage).toHaveBeenCalled();
  });
}); 