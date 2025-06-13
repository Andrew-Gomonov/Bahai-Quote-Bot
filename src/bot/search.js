const Fuse = require('fuse.js');
const { db: sharedDb } = require('../core/db');

let quotesCache = [];
let fuse = null;
let authorFuse = null;
let themeFuse = null;
let authors = [];
let themes = [];

// Загружаем цитаты с дополнительными полями
function loadQuotesForSearch(callback) {
  sharedDb.all('SELECT * FROM quotes', (err, rows) => {
    if (err) {
      console.error('[SEARCH] Ошибка загрузки цитат:', err);
      quotesCache = [];
      if (callback) callback(err);
      return;
    }
    
    quotesCache = rows || [];
    
    // Извлекаем уникальных авторов и темы
    authors = [...new Set(quotesCache
      .filter(q => q.author && q.author.trim())
      .map(q => q.author.trim())
    )];
    
    themes = [...new Set(quotesCache
      .filter(q => q.theme && q.theme.trim())  
      .map(q => q.theme.trim())
    )];
    
    // Инициализируем поиск по тексту
    fuse = new Fuse(quotesCache, { 
      keys: ['text'], 
      threshold: 0.4,
      includeScore: true
    });
    
    // Инициализируем поиск по авторам
    authorFuse = new Fuse(authors, { 
      threshold: 0.3,
      includeScore: true
    });
    
    // Инициализируем поиск по темам
    themeFuse = new Fuse(themes, { 
      threshold: 0.3,
      includeScore: true
    });
    
    console.log(`[INFO] Загружено ${quotesCache.length} цитат для поиска`);
    console.log(`[INFO] Найдено ${authors.length} уникальных авторов`);
    console.log(`[INFO] Найдено ${themes.length} уникальных тем`);
    
    if (callback) callback(null, quotesCache.length);
  });
}

// Поиск по тексту
function searchByText(query, limit = 5) {
  if (!fuse) return [];
  return fuse.search(query, { limit }).map((r) => r.item);
}

// Поиск по автору
function searchByAuthor(authorQuery, limit = 10) {
  if (!authorFuse) return [];
  
  // Сначала находим подходящих авторов
  const matchingAuthors = authorFuse.search(authorQuery, { limit: 5 });
  if (!matchingAuthors.length) return [];
  
  // Затем находим все цитаты этих авторов
  const authors = matchingAuthors.map(r => r.item);
  const quotes = quotesCache.filter(q => 
    q.author && authors.some(author => 
      q.author.toLowerCase().includes(author.toLowerCase()) ||
      author.toLowerCase().includes(q.author.toLowerCase())
    )
  );
  
  return quotes.slice(0, limit);
}

// Поиск по теме
function searchByTheme(themeQuery, limit = 10) {
  if (!themeFuse) return [];
  
  // Сначала находим подходящие темы
  const matchingThemes = themeFuse.search(themeQuery, { limit: 5 });
  if (!matchingThemes.length) return [];
  
  // Затем находим все цитаты этих тем
  const themes = matchingThemes.map(r => r.item);
  const quotes = quotesCache.filter(q => 
    q.theme && themes.some(theme => 
      q.theme.toLowerCase().includes(theme.toLowerCase()) ||
      theme.toLowerCase().includes(q.theme.toLowerCase())
    )
  );
  
  return quotes.slice(0, limit);
}

// Универсальный расширенный поиск
function advancedSearch(query, searchType = 'all', limit = 5) {
  if (!query || !query.trim()) return [];
  
  const cleanQuery = query.trim();
  let results = [];
  
  switch (searchType) {
    case 'author':
      results = searchByAuthor(cleanQuery, limit);
      break;
    case 'theme':
      results = searchByTheme(cleanQuery, limit);
      break;
    case 'text':
      results = searchByText(cleanQuery, limit);
      break;
    case 'all':
    default:
      // Поиск во всех полях
      const textResults = searchByText(cleanQuery, Math.ceil(limit / 3));
      const authorResults = searchByAuthor(cleanQuery, Math.ceil(limit / 3));
      const themeResults = searchByTheme(cleanQuery, Math.ceil(limit / 3));
      
      // Объединяем результаты, избегая дубликатов
      const allResults = [...textResults, ...authorResults, ...themeResults];
      const uniqueResults = allResults.filter((quote, index, self) => 
        index === self.findIndex(q => q.id === quote.id)
      );
      
      results = uniqueResults.slice(0, limit);
      break;
  }
  
  return results;
}

// Получить список всех авторов
function getAllAuthors() {
  const authors = [...new Set(quotesCache.filter(q => q.author).map(q => q.author))];
  return authors.sort();
}

// Получить список всех тем
function getAllThemes() {
  const themes = [...new Set(quotesCache.filter(q => q.theme).map(q => q.theme))];
  return themes.sort();
}

// Получить статистику поиска
function getSearchStats() {
  const total = quotesCache.length;
  const withAuthor = quotesCache.filter(q => q.author).length;
  const withTheme = quotesCache.filter(q => q.theme).length;
  const withSource = quotesCache.filter(q => q.source).length;
  
  return {
    total,
    withAuthor,
    withTheme,
    withSource,
    uniqueAuthors: getAllAuthors().length,
    uniqueThemes: getAllThemes().length
  };
}

// Форматирование результата поиска с дополнительной информацией
function formatSearchResult(quote, showMeta = true) {
  let result = `#${quote.id}\n\n${quote.text}`;
  
  if (showMeta) {
    const meta = [];
    if (quote.author) meta.push(`👤 Автор: ${quote.author}`);
    if (quote.theme) meta.push(`🏷️ Тема: ${quote.theme}`);
    if (quote.source) meta.push(`📖 Источник: ${quote.source}`);
    
    if (meta.length > 0) {
      result += '\n\n' + meta.join('\n');
    }
  }
  
  return result;
}

// Поиск похожих цитат (по автору или теме)
function findSimilarQuotes(quoteId, limit = 3) {
  const quote = quotesCache.find(q => q.id === quoteId);
  if (!quote) return [];
  
  let similar = [];
  
  // Ищем цитаты того же автора
  if (quote.author) {
    similar = similar.concat(
      quotesCache.filter(q => 
        q.id !== quoteId && 
        q.author && 
        q.author.toLowerCase() === quote.author.toLowerCase()
      )
    );
  }
  
  // Ищем цитаты той же темы
  if (quote.theme) {
    similar = similar.concat(
      quotesCache.filter(q => 
        q.id !== quoteId && 
        q.theme && 
        q.theme.toLowerCase() === quote.theme.toLowerCase() &&
        !similar.find(s => s.id === q.id) // избегаем дубликатов
      )
    );
  }
  
  // Возвращаем случайную выборку
  const shuffled = similar.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, limit);
}

module.exports = {
  loadQuotesForSearch,
  searchByText,
  searchByAuthor,
  searchByTheme,
  advancedSearch,
  getAllAuthors,
  getAllThemes,
  getSearchStats,
  formatSearchResult,
  findSimilarQuotes
}; 