const Fuse = require('fuse.js');
const { isFavorite } = require('./favorites');
const { loadQuotesForSearch } = require('./search');
const { isExplanationsEnabled } = require('./aiExplainer');

let quotesCache = [];
let fuse = null;

function loadQuotes(db, callback) {
  // Пытаемся загрузить цитаты с метаданными, если не получается - только базовые поля
  db.all('SELECT id, text, author, theme, source FROM quotes', (err, rows) => {
    if (err) {
      console.warn('[QUOTES] Не удалось загрузить расширенные данные, пробуем базовые:', err.message);
      // Fallback к базовым полям если расширенные недоступны
      db.all('SELECT id, text FROM quotes', (err2, basicRows) => {
        if (err2) {
          console.error('[QUOTES] Критическая ошибка загрузки цитат:', err2);
          if (callback) callback(err2);
          return;
        }
        quotesCache = (basicRows || []).map(row => ({
          ...row,
          author: null,
          theme: null, 
          source: null
        }));
        fuse = new Fuse(quotesCache, { keys: ['text'], threshold: 0.4 });
        console.log(`[QUOTES] Загружено ${quotesCache.length} цитат (только базовые поля).`);
        if (callback) callback(null, quotesCache.length);
      });
      return;
    }
    
    quotesCache = rows || [];
    fuse = new Fuse(quotesCache, { keys: ['text'], threshold: 0.4 });
    console.log(`[QUOTES] Загружено ${quotesCache.length} цитат.`);
    
    // Загружаем расширенные данные для поиска после основных цитат
    loadQuotesForSearch((searchErr, searchCount) => {
      if (searchErr) {
        console.error('[QUOTES] Ошибка загрузки цитат для поиска:', searchErr);
      } else {
        console.log(`[QUOTES] Поиск инициализирован для ${searchCount} цитат.`);
      }
    });
    
    if (callback) callback(null, quotesCache.length);
  });
}

function getRandomQuote() {
  if (!quotesCache.length) return null;
  const idx = Math.floor(Math.random() * quotesCache.length);
  return quotesCache[idx];
}

function getQuoteById(id) {
  return quotesCache.find((q) => q.id === id);
}

function searchQuotes(query, limit = 5) {
  if (!fuse) return [];
  return fuse.search(query, { limit }).map((r) => r.item);
}

function formatQuote(q, showMeta = false) {
  let result = `#${q.id}\n\n${q.text}`;
  
  if (showMeta) {
    const meta = [];
    if (q.author) meta.push(`👤 ${q.author}`);
    if (q.theme) meta.push(`🏷️ ${q.theme}`);
    if (q.source) meta.push(`📖 ${q.source}`);
    
    if (meta.length > 0) {
      result += '\n\n' + meta.join(' • ');
    }
  }
  
  return result;
}

async function sendQuote(bot, chatId, quote, opts = {}) {
  try {
    const isFav = await isFavorite(chatId, quote.id);
    const favoriteText = isFav ? '⭐ Убрать' : '⭐ Добавить';
    
    // Определяем, показывать ли метаинформацию
    const showMeta = quote.author || quote.theme || quote.source;
    
    // Создаем клавиатуру с учетом статуса функции объяснений
    const keyboard = [
      [
        { text: '🔄 Ещё', callback_data: 'more' },
        { text: favoriteText, callback_data: `fav_${quote.id}` }
      ]
    ];
    
    // Добавляем кнопку объяснения, если функция включена
    if (isExplanationsEnabled()) {
      keyboard.push([
        { text: '💡 Объяснить', callback_data: `explain_${quote.id}` }
      ]);
    }
    
    return bot.sendMessage(chatId, formatQuote(quote, showMeta), {
      reply_markup: {
        inline_keyboard: keyboard,
      },
      ...opts,
    });
  } catch (error) {
    console.error('Ошибка в sendQuote:', error);
    // Fallback без кнопки избранного
    const fallbackKeyboard = [[{ text: '🔄 Ещё', callback_data: 'more' }]];
    
    // Добавляем кнопку объяснения если функция включена
    if (isExplanationsEnabled()) {
      fallbackKeyboard.push([{ text: '💡 Объяснить', callback_data: `explain_${quote.id}` }]);
    }
    
    return bot.sendMessage(chatId, formatQuote(quote), {
      reply_markup: {
        inline_keyboard: fallbackKeyboard,
      },
      ...opts,
    });
  }
}

function getQuotesCount() {
  return quotesCache.length;
}

module.exports = {
  loadQuotes,
  getRandomQuote,
  getQuoteById,
  searchQuotes,
  formatQuote,
  sendQuote,
  getQuotesCount,
}; 