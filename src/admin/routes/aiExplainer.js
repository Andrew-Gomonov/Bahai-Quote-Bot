const express = require('express');
const router = express.Router();
const {
  getExplanationsStatus,
  enableExplanations,
  disableExplanations,
  getExplanationStats,
  clearOldExplanations,
  generateQuoteExplanation,
  getCachedExplanation
} = require('../../bot/aiExplainer');

// Страница управления ИИ объяснениями
router.get('/', async (req, res) => {
  try {
    const status = await getExplanationsStatus();
    const stats = await getExplanationStats();
    
    res.render('ai-explainer', {
      title: 'Управление ИИ объяснениями',
      status,
      stats,
      currentPage: 'ai-explainer'
    });
  } catch (error) {
    console.error('Error loading AI explainer page:', error);
    res.render('error', { 
      title: 'Ошибка',
      error: 'Не удалось загрузить данные' 
    });
  }
});

// Включение функции объяснений
router.post('/enable', (req, res) => {
  try {
    enableExplanations();
    res.redirect('/ai-explainer?success=' + encodeURIComponent('Функция ИИ объяснений включена'));
  } catch (error) {
    console.error('Error enabling explanations:', error);
    res.redirect('/ai-explainer?error=' + encodeURIComponent('Ошибка включения функции'));
  }
});

// Отключение функции объяснений
router.post('/disable', (req, res) => {
  try {
    const reason = req.body.reason || 'Отключено администратором';
    disableExplanations(reason);
    res.redirect('/ai-explainer?success=' + encodeURIComponent('Функция ИИ объяснений отключена'));
  } catch (error) {
    console.error('Error disabling explanations:', error);
    res.redirect('/ai-explainer?error=' + encodeURIComponent('Ошибка отключения функции'));
  }
});

// Очистка старых объяснений
router.post('/clear-old', async (req, res) => {
  try {
    const days = parseInt(req.body.days) || 30;
    const deleted = await clearOldExplanations(days);
    res.json({ success: true, deleted });
  } catch (error) {
    console.error('Error clearing old explanations:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Массовая генерация объяснений
router.post('/generate-all', async (req, res) => {
  try {
    const { db } = require('../../core/db');
    
    // Получаем все цитаты без объяснений
    const quotes = await new Promise((resolve, reject) => {
      db.all(`
        SELECT q.id, q.text 
        FROM quotes q 
        LEFT JOIN quote_explanations e ON q.id = e.quote_id 
        WHERE e.quote_id IS NULL
        LIMIT 10
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    let generated = 0;
    
    for (const quote of quotes) {
      try {
        await generateQuoteExplanation(quote);
        generated++;
      } catch (error) {
        console.error(`Error generating explanation for quote ${quote.id}:`, error);
        // Продолжаем генерацию для остальных цитат
      }
    }
    
    res.json({ 
      success: true, 
      generated, 
      total: quotes.length,
      message: `Сгенерировано ${generated} объяснений из ${quotes.length} цитат`
    });
    
  } catch (error) {
    console.error('Error in mass generation:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Тестирование OpenAI API
router.post('/test-api', async (req, res) => {
  try {
    const { gptGenerate } = require('../../bot/gpt');
    
    // Делаем минимальный тестовый запрос
    const testResult = await gptGenerate('Тест соединения', 'Ответь "OK"');
    
    if (testResult && testResult.includes('insufficient_quota')) {
      res.json({ 
        success: false, 
        message: 'Превышена квота OpenAI' 
      });
    } else if (testResult) {
      res.json({ 
        success: true, 
        message: 'API работает нормально' 
      });
    } else {
      res.json({ 
        success: false, 
        message: 'Нет ответа от API' 
      });
    }
    
  } catch (error) {
    console.error('Error testing API:', error);
    if (error.message && error.message.includes('insufficient_quota')) {
      res.json({ 
        success: false, 
        message: 'Превышена квота OpenAI' 
      });
    } else {
      res.json({ 
        success: false, 
        message: error.message || 'Неизвестная ошибка API' 
      });
    }
  }
});

// API для получения статуса (JSON)
router.get('/api/status', async (req, res) => {
  try {
    const status = await getExplanationsStatus();
    const stats = await getExplanationStats();
    res.json({ status, stats });
  } catch (error) {
    console.error('Error getting API status:', error);
    res.status(500).json({ error: 'Не удалось получить статус' });
  }
});

module.exports = router; 