const express = require('express');
const router = express.Router();
const { db: sharedDb } = require('../../core/db');
const { 
  getAllAuthors, 
  getAllThemes, 
  getSearchStats,
  loadQuotesForSearch 
} = require('../../bot/search');

function db() { return sharedDb; }

// Страница управления поиском
router.get('/', (req, res) => {
  const d = db();
  d.all('SELECT * FROM quotes LIMIT 200', (err, rows) => {
    if (err) {
      return res.status(500).send(err.message);
    }
    
    res.render('search', { title: 'Поиск цитат', rows });
  });
});

// Статистика поиска
router.get('/stats', (req, res) => {
  const d = db();
  d.all('SELECT * FROM quotes', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const total = rows.length;
    const withAuthor = rows.filter(r => r.author && r.author.trim()).length;
    const withTheme = rows.filter(r => r.theme && r.theme.trim()).length;
    const withSource = rows.filter(r => r.source && r.source.trim()).length;
    
    const authors = [...new Set(rows.filter(r => r.author && r.author.trim()).map(r => r.author))];
    const themes = [...new Set(rows.filter(r => r.theme && r.theme.trim()).map(r => r.theme))];
    
    const stats = {
      total,
      withAuthor,
      withTheme, 
      withSource,
      uniqueAuthors: authors.length,
      uniqueThemes: themes.length
    };

    res.json(stats);
  });
});

// Список авторов
router.get('/authors', (req, res) => {
  try {
    // Загружаем данные если нужно
    loadQuotesForSearch(() => {});
    
    // Получаем авторов напрямую из базы
    const d = db();
    d.all('SELECT DISTINCT author FROM quotes WHERE author IS NOT NULL AND author != "" ORDER BY author', (err, rows) => {
      if (err) {
        console.error('Error getting authors:', err);
        return res.status(500).json({ error: 'Failed to get authors' });
      }
      
      const authors = rows.map(row => row.author);
      res.json(authors);
    });
  } catch (error) {
    console.error('Error in authors route:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Список тем
router.get('/themes', (req, res) => {
  try {
    // Загружаем данные если нужно
    loadQuotesForSearch(() => {});
    
    // Получаем темы напрямую из базы
    const d = db();
    d.all('SELECT DISTINCT theme FROM quotes WHERE theme IS NOT NULL AND theme != "" ORDER BY theme', (err, rows) => {
      if (err) {
        console.error('Error getting themes:', err);
        return res.status(500).json({ error: 'Failed to get themes' });
      }
      
      const themes = rows.map(row => row.theme);
      res.json(themes);
    });
  } catch (error) {
    console.error('Error in themes route:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Цитаты по автору
router.get('/by-author/:author', (req, res) => {
  const author = decodeURIComponent(req.params.author);
  
  db().all(
    'SELECT id, text, theme, source FROM quotes WHERE author = ? ORDER BY id',
    [author],
    (err, quotes) => {
      if (err) {
        console.error('Error getting quotes by author:', err);
        return res.status(500).json({ error: 'Failed to get quotes' });
      }
      res.json(quotes);
    }
  );
});

// Цитаты по теме
router.get('/by-theme/:theme', (req, res) => {
  const theme = decodeURIComponent(req.params.theme);
  
  db().all(
    'SELECT id, text, author, source FROM quotes WHERE theme = ? ORDER BY id',
    [theme],
    (err, quotes) => {
      if (err) {
        console.error('Error getting quotes by theme:', err);
        return res.status(500).json({ error: 'Failed to get quotes' });
      }
      res.json(quotes);
    }
  );
});

// Обновление метаданных цитаты
router.put('/quote/:id/metadata', (req, res) => {
  const quoteId = req.params.id;
  const { author, theme, source } = req.body;
  
  db().run(
    'UPDATE quotes SET author = ?, theme = ?, source = ? WHERE id = ?',
    [author || null, theme || null, source || null, quoteId],
    function(err) {
      if (err) {
        console.error('Error updating quote metadata:', err);
        return res.status(500).json({ error: 'Failed to update metadata' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Quote not found' });
      }
      
      // Перезагружаем данные для поиска
      loadQuotesForSearch(() => {});
      res.json({ success: true, message: 'Metadata updated successfully' });
    }
  );
});

// Поиск цитат без метаданных
router.get('/missing-metadata', (req, res) => {
  const type = req.query.type; // 'author', 'theme', 'source'
  
  let query = 'SELECT id, text, author, theme, source FROM quotes WHERE ';
  let params = [];
  
  switch (type) {
    case 'author':
      query += 'author IS NULL OR author = ""';
      break;
    case 'theme':
      query += 'theme IS NULL OR theme = ""';
      break;
    case 'source':
      query += 'source IS NULL OR source = ""';
      break;
    default:
      query += '(author IS NULL OR author = "") OR (theme IS NULL OR theme = "") OR (source IS NULL OR source = "")';
  }
  
  query += ' ORDER BY id';
  
  db().all(query, params, (err, quotes) => {
    if (err) {
      console.error('Error getting quotes with missing metadata:', err);
      return res.status(500).json({ error: 'Failed to get quotes' });
    }
    res.json(quotes);
  });
});

// Массовое обновление метаданных
router.post('/bulk-update', (req, res) => {
  const updates = req.body.updates; // Array of {id, author, theme, source}
  
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'Invalid updates array' });
  }
  
  db().serialize(() => {
    db().run('BEGIN TRANSACTION');
    
    let completed = 0;
    let errors = 0;
    
    updates.forEach(update => {
      db().run(
        'UPDATE quotes SET author = ?, theme = ?, source = ? WHERE id = ?',
        [update.author || null, update.theme || null, update.source || null, update.id],
        function(err) {
          if (err) {
            console.error('Error in bulk update:', err);
            errors++;
          }
          
          completed++;
          
          if (completed === updates.length) {
            if (errors === 0) {
              db().run('COMMIT', (commitErr) => {
                if (commitErr) {
                  console.error('Commit error:', commitErr);
                  return res.status(500).json({ error: 'Failed to commit updates' });
                }
                
                // Перезагружаем данные для поиска
                loadQuotesForSearch(() => {});
                res.json({ 
                  success: true, 
                  message: `Successfully updated ${updates.length} quotes`,
                  updated: updates.length 
                });
              });
            } else {
              db().run('ROLLBACK');
              res.status(500).json({ 
                error: `Failed to update some quotes. Errors: ${errors}/${updates.length}` 
              });
            }
          }
        }
      );
    });
  });
});

module.exports = router; 