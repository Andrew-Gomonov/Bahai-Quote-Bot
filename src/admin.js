require('dotenv').config();

/*
 * Simple Admin Web Panel for Bahá'í Quote Bot
 * Uses basic HTTP auth; manage quotes and broadcasts.
 */

const express = require('express');
const basicAuth = require('express-basic-auth');
const sqlite3 = require('sqlite3');
const path = require('path');

const PORT = Number(process.env.ADMIN_PORT || 3000);
const DB_PATH = path.resolve(process.env.DB_PATH || 'bot.db');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin';

const app = express();
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(
  basicAuth({
    users: { [ADMIN_USER]: ADMIN_PASS },
    challenge: true,
    realm: 'BahaiQuoteBot',
  })
);

function db() {
  return new sqlite3.Database(DB_PATH);
}

function html(title, body) {
  return `<!DOCTYPE html>
  <html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet" />
  </head>
  <body class="container py-4">
    <nav class="mb-4">
      <a class="btn btn-outline-primary me-2" href="/">Главная</a>
      <a class="btn btn-outline-primary me-2" href="/quotes">Цитаты</a>
      <a class="btn btn-outline-primary me-2" href="/broadcasts">Рассылки</a>
    </nav>
    ${body}
  </body>
  </html>`;
}

// Dashboard
app.get('/', (req, res) => {
  const d = db();
  d.serialize(() => {
    d.get('SELECT COUNT(*) AS n FROM quotes', (e1, q) => {
      if (e1) return res.status(500).send(e1.message);
      d.get('SELECT COUNT(*) AS n FROM users', (e2, u) => {
        if (e2) return res.status(500).send(e2.message);
        d.get('SELECT COUNT(*) AS n FROM broadcasts', (e3, b) => {
          if (e3) return res.status(500).send(e3.message);
          res.send(
            html(
              'Dashboard',
              `
<h2 class="mb-4">Статистика</h2>
<div class="row text-center">
  <div class="col-md-4">
    <div class="card shadow-sm mb-3">
      <div class="card-body">
        <h3 class="display-6">${q.n}</h3>
        <p class="mb-0">Цитат</p>
      </div>
    </div>
  </div>
  <div class="col-md-4">
    <div class="card shadow-sm mb-3 border-success">
      <div class="card-body">
        <h3 class="display-6 text-success">${u.n}</h3>
        <p class="mb-0">Пользователей</p>
      </div>
    </div>
  </div>
  <div class="col-md-4">
    <div class="card shadow-sm mb-3 border-warning">
      <div class="card-body">
        <h3 class="display-6 text-warning">${b.n}</h3>
        <p class="mb-0">Рассылок</p>
      </div>
    </div>
  </div>
</div>

<div class="card p-4 shadow-sm">
  <canvas id="statsChart" height="120"></canvas>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script>
const ctx = document.getElementById('statsChart').getContext('2d');
new Chart(ctx, {
  type: 'doughnut',
  data: {
    labels: ['Цитаты', 'Пользователи', 'Рассылки'],
    datasets: [{
      data: [${q.n}, ${u.n}, ${b.n}],
      backgroundColor: ['#0d6efd', '#198754', '#ffc107'],
    }]
  },
  options: {
    plugins: { legend: { position: 'bottom' } }
  }
});
</script>`
            )
          );
          d.close();
        });
      });
    });
  });
});

// Quotes list & add form
app.get('/quotes', (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : null;
  const d = db();
  const sql = search ? 'SELECT * FROM quotes WHERE text LIKE ? LIMIT 200' : 'SELECT * FROM quotes LIMIT 200';
  d.all(sql, search ? [search] : [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    const listItems = rows
      .map(
        (r) => `<li class="list-group-item"><strong>#${r.id}</strong> ${r.text.slice(0, 100)}…
          <form method="POST" action="/quotes/delete/${r.id}" class="d-inline ms-2">
            <button class="btn btn-sm btn-danger">Удалить</button>
          </form></li>`
      )
      .join('');

    const body = `<h2>Цитаты</h2>
      <form class="input-group mb-3" method="GET" action="/quotes">
        <input type="text" name="search" class="form-control" placeholder="Поиск" value="${
          req.query.search || ''
        }" />
        <button class="btn btn-outline-secondary">Найти</button>
      </form>
      <ul class="list-group mb-4" style="max-height:400px;overflow:auto;">${listItems}</ul>
      <h4>Новая цитата</h4>
      <form method="POST" action="/quotes">
        <textarea name="text" class="form-control mb-2" rows="4" required></textarea>
        <button class="btn btn-primary">Добавить</button>
      </form>`;

    res.send(html('Цитаты', body));
    d.close();
  });
});

app.post('/quotes', (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.redirect('/quotes');
  const d = db();
  d.run('INSERT INTO quotes(text) VALUES (?)', [text], () => {
    d.close();
    res.redirect('/quotes');
  });
});

app.post('/quotes/delete/:id', (req, res) => {
  const id = Number(req.params.id);
  const d = db();
  d.run('DELETE FROM quotes WHERE id = ?', [id], () => {
    d.close();
    res.redirect('/quotes');
  });
});

// Broadcasts
app.get('/broadcasts', (req, res) => {
  const d = db();
  d.all('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 100', (err, rows) => {
    if (err) return res.status(500).send(err.message);
    const listItems = rows
      .map((b) => {
        const markImg = b.image ? '📷' : '';
        const mark = b.sent ? '✅' : b.type === 'weekly' ? '🔄' : '⏰';
        return `<li class="list-group-item">${mark} ${markImg} <strong>#${b.id}</strong> [${b.type}] ${b.schedule} – ${
          b.message.slice(0, 70)
        }…</li>`;
      })
      .join('');

    const body = `<h2>Рассылки</h2>
      <ul class="list-group mb-4" style="max-height:400px;overflow:auto;">${listItems}</ul>
      <h4>Новая PUSH рассылка</h4>
      <form method="POST" action="/broadcasts/push" class="mb-4">
        <div class="row g-2 mb-2">
          <div class="col"><input type="date" name="date" class="form-control" required></div>
          <div class="col"><input type="time" name="time" class="form-control" required></div>
        </div>
        <textarea name="message" class="form-control mb-2" rows="3" required></textarea>
        <input type="text" name="image" class="form-control mb-2" placeholder="Ссылка/ID картинки (опц.)" />
        <button class="btn btn-primary">Добавить PUSH</button>
      </form>
      <h4>Новая Weekly рассылка</h4>
      <form method="POST" action="/broadcasts/weekly">
        <div class="row g-2 mb-2">
          <div class="col">
            <select name="day" class="form-select">
              <option value="1">Пн</option><option value="2">Вт</option><option value="3">Ср</option><option value="4">Чт</option><option value="5">Пт</option><option value="6">Сб</option><option value="7">Вс</option>
            </select>
          </div>
          <div class="col"><input type="time" name="time" class="form-control" required></div>
        </div>
        <textarea name="message" class="form-control mb-2" rows="3" required></textarea>
        <input type="text" name="image" class="form-control mb-2" placeholder="Ссылка/ID картинки (опц.)" />
        <button class="btn btn-primary">Добавить Weekly</button>
      </form>`;

    res.send(html('Рассылки', body));
    d.close();
  });
});

app.post('/broadcasts/push', (req, res) => {
  const { date, time, message, image } = req.body;
  if (!(date && time && message)) return res.redirect('/broadcasts');
  const iso = `${date}T${time}:00Z`;
  const d = db();
  d.run('INSERT INTO broadcasts(type, schedule, message, image) VALUES ("push", ?, ?, ?)', [iso, message, image || null], () => {
    d.close();
    res.redirect('/broadcasts');
  });
});

app.post('/broadcasts/weekly', (req, res) => {
  const { day, time, message, image } = req.body;
  if (!(day && time && message)) return res.redirect('/broadcasts');
  const sched = `${day}|${time}`;
  const d = db();
  d.run('INSERT INTO broadcasts(type, schedule, message, image) VALUES ("weekly", ?, ?, ?)', [sched, message, image || null], () => {
    d.close();
    res.redirect('/broadcasts');
  });
});

app.listen(PORT, () => {
  console.log(`[ADMIN] Panel running on http://localhost:${PORT} (login ${ADMIN_USER}/${ADMIN_PASS})`);
}); 