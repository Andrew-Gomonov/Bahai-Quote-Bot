const { gptGenerate } = require('./gpt');
const { db } = require('../core/db');
const timeManager = require('../core/timeUtils');

// Глобальное состояние функции объяснений
let explanationsEnabled = true;
let lastQuotaCheckTime = 0;
const QUOTA_CHECK_INTERVAL = 30 * 60 * 1000; // 30 минут

// Проверка статуса функции объяснений
function isExplanationsEnabled() {
  return explanationsEnabled;
}

// Отключение функции объяснений
function disableExplanations(reason = 'Превышена квота OpenAI') {
  explanationsEnabled = false;
  console.log(`[AI Explainer] Функция объяснений отключена: ${reason}`);
  
  // Записываем в базу данных время отключения
  const now = new Date().toISOString();
  db.run(
    `INSERT OR REPLACE INTO ai_explainer_status (id, enabled, disabled_at, disable_reason) 
     VALUES (1, 0, ?, ?)`,
    [now, reason],
    (err) => {
      if (err) console.error('[AI Explainer] Ошибка записи статуса:', err);
    }
  );
}

// Включение функции объяснений
function enableExplanations() {
  explanationsEnabled = true;
  console.log('[AI Explainer] Функция объяснений включена');
  
  // Обновляем статус в базе данных
  db.run(
    `INSERT OR REPLACE INTO ai_explainer_status (id, enabled, enabled_at) 
     VALUES (1, 1, ?)`,
    [new Date().toISOString()],
    (err) => {
      if (err) console.error('[AI Explainer] Ошибка записи статуса:', err);
    }
  );
}

// Функция для генерации объяснения цитаты
async function generateQuoteExplanation(quote) {
  try {
    // Проверяем, включена ли функция
    if (!explanationsEnabled) {
      return 'Функция ИИ объяснений временно недоступна. Обратитесь к администратору.';
    }

    // Проверяем, есть ли уже сохраненное объяснение
    const cachedExplanation = await getCachedExplanation(quote.id);
    if (cachedExplanation) {
      return cachedExplanation;
    }

    // Формируем промпт для GPT
    const prompt = createExplanationPrompt(quote);
    
    // Генерируем объяснение через GPT
    const explanation = await gptGenerate(prompt);
    
    // Проверяем на ошибки квоты
    if (explanation && explanation === '(insufficient_quota)') {
      console.error('[AI Explainer] Превышена квота OpenAI, отключаю функцию');
      disableExplanations('Превышена квота OpenAI');
      return 'Функция ИИ объяснений временно недоступна из-за превышения квоты. Обратитесь к администратору.';
    }
    
    if (explanation && explanation !== '(GPT error)' && explanation !== '(GPT empty)' && explanation !== '(GPT key missing)' && explanation !== '(insufficient_quota)') {
      // Сохраняем в кэш
      await cacheExplanation(quote.id, explanation);
      return explanation;
    }
    
    return 'К сожалению, не удалось создать объяснение для этой цитаты. Попробуйте позже.';
    
  } catch (error) {
    console.error('[AI Explainer] Error:', error);
    
    // Проверяем, является ли ошибка связанной с квотой
    if (error.message && error.message.includes('insufficient_quota')) {
      disableExplanations('Превышена квота OpenAI');
      return 'Функция ИИ объяснений временно недоступна из-за превышения квоты. Обратитесь к администратору.';
    }
    
    return 'Произошла ошибка при создании объяснения.';
  }
}

// Создание промпта для объяснения цитаты
function createExplanationPrompt(quote) {
  let context = '';
  if (quote.author) context += `Автор: ${quote.author}\n`;
  if (quote.theme) context += `Тема: ${quote.theme}\n`;
  if (quote.source) context += `Источник: ${quote.source}\n`;

  return `Ты - эксперт по учению Бахаи и духовной мудрости. Проанализируй следующую цитату и дай краткое (3-4 предложения) объяснение её смысла и практической ценности для современного человека.

${context ? context + '\n' : ''}Цитата: "${quote.text}"

Объясни:
1. Основной смысл и послание
2. Какую практическую ценность это может принести в повседневной жизни
3. Как это может помочь в духовном развитии или решении жизненных вопросов

Ответ должен быть вдохновляющим, понятным и практичным. Пиши на русском языке.`;
}

// Получение кэшированного объяснения
function getCachedExplanation(quoteId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT explanation FROM quote_explanations WHERE quote_id = ?',
      [quoteId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.explanation : null);
        }
      }
    );
  });
}

// Сохранение объяснения в кэш
function cacheExplanation(quoteId, explanation) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    db.run(
      `INSERT OR REPLACE INTO quote_explanations (quote_id, explanation, created_at, updated_at) 
       VALUES (?, ?, ?, ?)`,
      [quoteId, explanation, now, now],
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

// Получение статистики объяснений для админ панели
function getExplanationStats() {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 
        COUNT(*) as total_explanations,
        COUNT(DISTINCT quote_id) as quotes_with_explanations,
        (SELECT COUNT(*) FROM quotes) as total_quotes
       FROM quote_explanations`,
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            total_explanations: row.total_explanations || 0,
            quotes_with_explanations: row.quotes_with_explanations || 0,
            total_quotes: row.total_quotes || 0,
            coverage_percentage: row.total_quotes > 0 ? 
              Math.round((row.quotes_with_explanations / row.total_quotes) * 100) : 0
          });
        }
      }
    );
  });
}

// Очистка старых объяснений (для maintenance)
function clearOldExplanations(daysOld = 30) {
  return new Promise((resolve, reject) => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISO = cutoffDate.toISOString();
    
    db.run(
      'DELETE FROM quote_explanations WHERE updated_at < ?',
      [cutoffISO],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

// Форматирование объяснения для отправки пользователю
function formatExplanation(quote, explanation) {
  let header = `💡 **Объяснение цитаты #${quote.id}**\n\n`;
  
  // Показываем краткую версию цитаты если она длинная
  let quoteText = quote.text;
  if (quoteText.length > 100) {
    quoteText = quoteText.substring(0, 97) + '...';
  }
  
  header += `_"${quoteText}"_\n\n`;
  header += `💡 **${explanation}**\n\n`;
  header += `✨ _Используйте эту мудрость в своей повседневной жизни!_`;
  
  return header;
}

// Инициализация: загружаем состояние из базы данных
function initializeExplanationsStatus() {
  db.get(
    'SELECT enabled, disabled_at, disable_reason FROM ai_explainer_status WHERE id = 1',
    (err, row) => {
      if (err) {
        // Если таблица не существует (например, в тестах), просто создаем её
        if (err.code === 'SQLITE_ERROR' && err.message.includes('no such table')) {
          console.log('[AI Explainer] Таблица ai_explainer_status не найдена, создаю...');
          db.run(`CREATE TABLE IF NOT EXISTS ai_explainer_status (
            id INTEGER PRIMARY KEY DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 1,
            disabled_at TEXT,
            enabled_at TEXT,
            disable_reason TEXT
          )`, (createErr) => {
            if (createErr) {
              console.error('[AI Explainer] Ошибка создания таблицы:', createErr);
            } else {
              console.log('[AI Explainer] Таблица создана, функция включена по умолчанию');
            }
          });
          return;
        }
        console.error('[AI Explainer] Ошибка загрузки статуса:', err);
        return;
      }
      
      if (row) {
        explanationsEnabled = row.enabled === 1;
        console.log(`[AI Explainer] Загружен статус: ${explanationsEnabled ? 'включено' : 'отключено'}`);
        if (!explanationsEnabled && row.disable_reason) {
          console.log(`[AI Explainer] Причина отключения: ${row.disable_reason}`);
        }
      }
    }
  );
}

// Получение статуса функции для админ панели
function getExplanationsStatus() {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT enabled, disabled_at, disable_reason, enabled_at FROM ai_explainer_status WHERE id = 1',
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            enabled: explanationsEnabled,
            disabled_at: row && row.disabled_at ? timeManager.formatForDisplay(row.disabled_at) : null,
            disable_reason: row ? row.disable_reason : null,
            enabled_at: row && row.enabled_at ? timeManager.formatForDisplay(row.enabled_at) : null
          });
        }
      }
    );
  });
}

// Автоматическая проверка квоты (пытается сделать тестовый запрос)
async function checkQuotaStatus() {
  if (!explanationsEnabled || Date.now() - lastQuotaCheckTime < QUOTA_CHECK_INTERVAL) {
    return explanationsEnabled;
  }
  
  lastQuotaCheckTime = Date.now();
  
  try {
    // Делаем минимальный тестовый запрос
    const testResult = await gptGenerate('Test');
    
    if (testResult && testResult.includes('insufficient_quota')) {
      disableExplanations('Превышена квота OpenAI (автопроверка)');
      return false;
    }
    
    return true;
  } catch (error) {
    if (error.message && error.message.includes('insufficient_quota')) {
      disableExplanations('Превышена квота OpenAI (автопроверка)');
      return false;
    }
    return explanationsEnabled;
  }
}

// Инициализируем при загрузке модуля
initializeExplanationsStatus();

module.exports = {
  generateQuoteExplanation,
  getCachedExplanation,
  cacheExplanation,
  getExplanationStats,
  clearOldExplanations,
  formatExplanation,
  isExplanationsEnabled,
  enableExplanations,
  disableExplanations,
  getExplanationsStatus,
  checkQuotaStatus,
  initializeExplanationsStatus
}; 