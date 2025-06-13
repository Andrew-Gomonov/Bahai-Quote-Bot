require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { DateTime } = require('luxon');
const Bluebird = require('bluebird');
const { version } = require('../package.json');
const { db, initDatabase: dbInit, DEFAULT_TZ, DEFAULT_DAILY_TIME } = require('./core/db');
const { startScheduler } = require('./core/scheduler');
const { loadQuotes, getRandomQuote, getQuoteById, searchQuotes, sendQuote, formatQuote, getQuotesCount } = require('./bot/quotes');
const { registerCommands } = require('./bot/commands');

// ================== CONFIG ==================
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.log('');
  console.log('🕊️  ══════════════════════════════════════════════════════════');
  console.log('❌ Ошибка конфигурации');
  console.log('🕊️  ══════════════════════════════════════════════════════════');
  console.log('🚫 Токен бота не найден!');
  console.log('');
  console.log('🔧 Решения:');
  console.log('   1. Создайте файл .env в корне проекта');
  console.log('   2. Добавьте в него: BOT_TOKEN=your_bot_token');
  console.log('   3. Получите токен у @BotFather в Telegram');
  console.log('');
  console.log('💡 Пример файла .env:');
  console.log('   BOT_TOKEN=123456789:ABCDEF1234567890ABCDEF1234567890ABC');
  console.log('   ADMIN_PORT=3000');
  console.log('   COOLDOWN_SEC=30');
  console.log('');
  console.log('📞 Нужна помощь? Обратитесь к: andrei.gomonov.md@gmail.com');
  console.log('🕊️  ══════════════════════════════════════════════════════════');
  console.log('');
  process.exit(1);
}

const COOLDOWN_SEC = process.env.COOLDOWN_SEC ? Number(process.env.COOLDOWN_SEC) : 30;

// ================== DATABASE ==================
dbInit(); // инициализация базы (создание таблиц)

// ================== LOAD QUOTES ==================
loadQuotes(db, (err, count) => {
  if (err) {
    console.error('❌ Критическая ошибка загрузки цитат:', err);
    process.exit(1);
  }
  console.log(`📚 Загружено ${count} цитат в кэш`);
});

// ================== BOT INITIALIZATION ==================
// Конфигурация бота с расширенными настройками для обработки ошибок сети
const botOptions = {
  polling: {
    autoStart: true,
    params: {
      timeout: 10,
      limit: 100
    }
  },
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4 // Принудительно IPv4 для избежания DNS проблем
    },
    timeout: 30000 // 30 секунд таймаут
  }
};

let bot;
let botStartRetries = 0;
const MAX_BOT_RETRIES = 5;

function initializeBot() {
  try {
    bot = new TelegramBot(TOKEN, botOptions);
    
    // Обработчики ошибок
    bot.on('polling_error', handlePollingError);
    bot.on('webhook_error', tgError);
    
    // Красивое сообщение о запуске
    console.log('');
    console.log('🕊️  ══════════════════════════════════════════════════════════');
    console.log(`✅ Bahai Quote Bot v${version} успешно запущен!`);
    console.log('🕊️  ══════════════════════════════════════════════════════════');
    console.log(`🤖 Telegram Bot API подключен`);
    console.log(`📂 Рабочая папка: ${__dirname}`);
    console.log(`⏰ Время запуска: ${new Date().toLocaleString('ru-RU')}`);
    console.log(`🔄 Cooldown: ${COOLDOWN_SEC} секунд`);
    console.log('');
    console.log('💡 Статус:');
    console.log('   • Polling активен - бот слушает сообщения');
    console.log('   • Планировщик рассылок запущен');
    console.log('   • База данных инициализирована');
    console.log('   • Для остановки нажмите Ctrl+C');
    console.log('');
    console.log('🕊️  ══════════════════════════════════════════════════════════');
    console.log('');
    
    // Регистрируем команды после успешной инициализации
    registerCommands(bot, db, broadcastToAll, tgError);
    startScheduler(db, bot, getRandomQuote, broadcastToAll);
    
    botStartRetries = 0; // Сброс счетчика при успешном запуске
    
  } catch (error) {
    console.error(`❌ Ошибка инициализации бота (попытка ${botStartRetries + 1}/${MAX_BOT_RETRIES}):`, error.message);
    
    if (botStartRetries < MAX_BOT_RETRIES) {
      botStartRetries++;
      const retryDelay = Math.min(5000 * botStartRetries, 30000); // Экспоненциальная задержка, максимум 30 сек
      console.log(`🔄 Повторная попытка через ${retryDelay/1000} секунд...`);
      setTimeout(initializeBot, retryDelay);
    } else {
      console.error('💥 Превышено максимальное количество попыток запуска бота!');
      console.error('🔧 Возможные причины:');
      console.error('   • Проблемы с интернет-соединением');
      console.error('   • Неверный BOT_TOKEN');
      console.error('   • Блокировка api.telegram.org');
      console.error('   • Проблемы с DNS');
      console.error('💡 Решения:');
      console.error('   • Проверьте интернет-соединение');
      console.error('   • Попробуйте позже');
      console.error('   • Используйте VPN если Telegram заблокирован');
      process.exit(1);
    }
  }
}

// Специальная обработка ошибок polling
function handlePollingError(error) {
  const errorCode = error.code;
  const errorMessage = error.message || '';
  
  // Сетевые ошибки - логируем и пытаемся переподключиться
  if (errorCode === 'EFATAL' || errorCode === 'EAI_AGAIN' || errorCode === 'ENOTFOUND' || errorCode === 'ETIMEDOUT') {
    console.warn(`🌐 Сетевая ошибка: ${errorMessage}`);
    console.warn('🔄 Пытаемся переподключиться через 10 секунд...');
    
    // Останавливаем polling и перезапускаем через 10 секунд
    if (bot) {
      try {
        bot.stopPolling();
      } catch (e) {
        // Игнорируем ошибки остановки
      }
    }
    
    setTimeout(() => {
      console.log('🔌 Переподключение к Telegram API...');
      initializeBot();
    }, 10000);
    
    return;
  }
  
  // Для остальных ошибок используем обычный обработчик
  tgError(error);
}

// Запускаем инициализацию бота
initializeBot();

// ================ HELPER FUNCTIONS =================

// Unified Telegram error handler to silence non-fatal API errors (e.g. "query is too old")
function tgError(err) {
  if (!err) return;
  
  const errorCode = err.code;
  const errorMessage = err.message || '';
  
  // Сетевые ошибки - логируем как предупреждения, а не критические ошибки
  if (errorCode === 'EFATAL' || errorCode === 'EAI_AGAIN' || errorCode === 'ENOTFOUND' || errorCode === 'ETIMEDOUT') {
    console.warn(`[TG NETWORK] ${errorCode}: ${errorMessage}`);
    console.warn('🌐 Временные проблемы с сетью. Бот попытается переподключиться...');
    return;
  }
  
  if (err.code === 'ETELEGRAM') {
    const desc = err.response?.body?.description || err.description || err.message || '';
    // Ignore frequent, non-critical errors
    const ignorablePatterns = [
      'query is too old',
      'message is not modified',
      'message to edit not found',
      'bot was blocked by the user',
      'terminated by other getUpdates request',
      'chat not found',
      'user not found'
    ];
    if (ignorablePatterns.some((p) => desc.includes(p))) {
      console.warn('[TG]', desc);
      return;
    }
  }
  
  console.error('[TG ERROR]', err);
}

process.on('unhandledRejection', tgError);
process.on('rejectionHandled', tgError);

// Trap Bluebird unhandled rejections
Bluebird.onPossiblyUnhandledRejection(tgError);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('');
  console.log('🕊️  ══════════════════════════════════════════════════════════');
  console.log('⏹️  Остановка Bahai Quote Bot...');
  console.log('🕊️  ══════════════════════════════════════════════════════════');
  console.log('📱 Отключаем Telegram polling...');
  
  if (bot) {
    try {
      bot.stopPolling();
      console.log('✅ Polling остановлен');
    } catch (e) {
      console.warn('⚠️ Ошибка при остановке polling:', e.message);
    }
  } else {
    console.log('ℹ️ Бот не был инициализирован');
  }
  
  console.log('💾 Закрываем базу данных...');
  try {
    db.close();
    console.log('✅ База данных закрыта');
  } catch (e) {
    console.warn('⚠️ Ошибка при закрытии БД:', e.message);
  }
  
  console.log('✅ Бот остановлен. До свидания! 🕊️');
  console.log('🕊️  ══════════════════════════════════════════════════════════');
  console.log('');
  process.exit(0);
});

async function broadcastToAll(text, image=null) {
  try {
    // Проверяем доступность бота
    if (!bot) {
      console.warn('[BROADCAST] Бот не инициализирован, пропускаем рассылку');
      return;
    }
    
    // Получаем пользователей через callback, поскольку db.all не возвращает Promise
    const users = await new Promise((resolve, reject) => {
      db.all('SELECT chat_id FROM users WHERE broadcast_enabled = 1', (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
    
    if (!Array.isArray(users) || users.length === 0) {
      console.log('[INFO] Нет пользователей для рассылки');
      return;
    }
    
    let sentCount = 0;
    let errorCount = 0;
    
    for (const u of users) {
      try {
        if (image) {
          await bot.sendPhoto(u.chat_id, image, { caption: text });
        } else {
          await bot.sendMessage(u.chat_id, text);
        }
        sentCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (userError) {
        errorCount++;
        const errorCode = userError.code;
        const errorMessage = userError.message || '';
        
        // Логируем разные типы ошибок по-разному
        if (errorCode === 'EFATAL' || errorCode === 'EAI_AGAIN' || errorCode === 'ENOTFOUND') {
          console.warn(`[BROADCAST] Сетевая ошибка для пользователя ${u.chat_id}: ${errorMessage}`);
        } else if (errorMessage.includes('blocked') || errorMessage.includes('deactivated')) {
          console.log(`[BROADCAST] Пользователь ${u.chat_id} заблокировал бота или деактивировал аккаунт`);
        } else {
          console.warn(`[BROADCAST] Не удалось отправить сообщение пользователю ${u.chat_id}: ${errorMessage}`);
        }
      }
    }
    
    console.log(`[INFO] Рассылка завершена: ${sentCount} отправлено, ${errorCount} ошибок из ${users.length} пользователей`);
    
  } catch (error) {
    console.error('❌ Критическая ошибка рассылки:', error);
    
    // Если это сетевая ошибка, даем дополнительную информацию
    if (error.code === 'EFATAL' || error.code === 'EAI_AGAIN') {
      console.error('🌐 Проблемы с сетью. Рассылка может быть отложена.');
    }
  }
} 