const express = require('express');
const router = express.Router();

const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const fs = require('fs');

const { db: sharedDb } = require('../../core/db');

// Helpers
function db() {
  return sharedDb;
}

// Список цитат + форма добавления
router.get('/', (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : null;
  const d = db();
  const sql = search ? 'SELECT * FROM quotes WHERE text LIKE ? LIMIT 200' : 'SELECT * FROM quotes LIMIT 200';
  d.all(sql, search ? [search] : [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.render('quotes', { title: 'Цитаты', rows });
  });
});

// Добавление цитаты
router.post('/', (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.redirect('/quotes');
  const d = db();
  d.run('INSERT INTO quotes(text) VALUES (?)', [text], () => {
    res.redirect('/quotes');
  });
});

// Удаление цитаты
router.post('/delete/:id', (req, res) => {
  const id = Number(req.params.id);
  const d = db();
  d.run('DELETE FROM quotes WHERE id = ?', [id], () => {
    res.redirect('/quotes');
  });
});

// Обновление цитаты
router.post('/update/:id', (req, res) => {
  const id = Number(req.params.id);
  const text = (req.body.text || '').trim();
  if (!text) return res.redirect('/quotes');
  const d = db();
  d.run('UPDATE quotes SET text = ? WHERE id = ?', [text, id], () => {
    res.redirect('/quotes');
  });
});

// Импорт цитат из JSON
router.post('/import', upload.single('quotesFile'), (req, res) => {
  if (!req.file) {
    return res.redirect('/quotes');
  }

  try {
    const content = fs.readFileSync(req.file.path, 'utf8');
    const quotes = JSON.parse(content);

    if (!Array.isArray(quotes)) {
      throw new Error('Invalid JSON format: expected array');
    }

    const d = db();
    const stmt = d.prepare('INSERT INTO quotes(text) VALUES (?)');

    let imported = 0;
    quotes.forEach((quote) => {
      if (quote && typeof quote.text === 'string' && quote.text.trim()) {
        stmt.run(quote.text.trim());
        imported++;
      }
    });

    stmt.finalize();

    // Удаляем загруженный файл
    fs.unlinkSync(req.file.path);

    console.log(`[ADMIN] Imported ${imported} quotes from JSON`);
    res.redirect('/quotes');
  } catch (err) {
    console.error('[ADMIN] Import error:', err);
    // Cleanup on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.redirect('/quotes');
  }
});

module.exports = router; 