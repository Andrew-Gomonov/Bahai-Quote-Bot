require('dotenv').config();

/*
 * Simple Admin Web Panel for Bahá'í Quote Bot
 * Uses basic HTTP auth; manage quotes and broadcasts.
 */

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const flash = require('connect-flash');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DateTime } = require('luxon');
const DEFAULT_TZ = 'Europe/Chisinau';
const expressLayouts = require('express-ejs-layouts');
const { version } = require('../package.json');
const { db: sharedDb, initDatabase } = require('./db');
const credentialsManager = require('./credentials');
const { passport, isAuthenticated } = require('./auth');
const bcrypt = require('bcrypt');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const envPath = path.join(__dirname, '..', '.env');

const PORT = Number(process.env.ADMIN_PORT || 3000);
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin';

const app = express();

// Настройка сессий
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: '.'
  }),
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 часа
  }
}));

// Парсинг urlencoded до инициализации passport
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Настройка flash-сообщений
app.use(flash());

// Настройка passport
app.use(passport.initialize());
app.use(passport.session());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);          
app.set('layout', 'layout');      // общий шаблон

// Добавляем версию в локальные переменные для всех шаблонов
app.locals.version = version;

// Middleware: передаём имя текущего пользователя во все шаблоны
app.use((req, res, next) => {
  res.locals.currentUser = req.user ? req.user.username : null;
  next();
});

// Глобальный middleware аутентификации
app.use(isAuthenticated);

let botProcess = null; // глобальная ссылка на запущенный процесс бота

// Переиспользуем единый экземпляр SQLite из db.js и отключаем close()
if (!sharedDb._adminPatched) {
  sharedDb.close = () => {};
  sharedDb._adminPatched = true;
}

// Ensure DB schema exists (web_admins etc.)
initDatabase();

function db() {
  return sharedDb;
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
          res.render('dashboard', { title:'Dashboard', quotes:q.n, users:u.n, broadcasts:b.n });
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
    res.render('quotes', { title:'Цитаты', rows });
  });
});

app.post('/quotes', (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.redirect('/quotes');
  const d = db();
  d.run('INSERT INTO quotes(text) VALUES (?)', [text], () => {
    res.redirect('/quotes');
  });
});

app.post('/quotes/delete/:id', (req, res) => {
  const id = Number(req.params.id);
  const d = db();
  d.run('DELETE FROM quotes WHERE id = ?', [id], () => {
    res.redirect('/quotes');
  });
});

app.post('/quotes/update/:id', (req, res) => {
  const id = Number(req.params.id);
  const text = (req.body.text || '').trim();
  if (!text) return res.redirect('/quotes');
  const d = db();
  d.run('UPDATE quotes SET text = ? WHERE id = ?', [text, id], () => {
    res.redirect('/quotes');
  });
});

// Quotes import
app.post('/quotes/import', upload.single('quotesFile'), (req, res) => {
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
    quotes.forEach(quote => {
      if (quote && typeof quote.text === 'string' && quote.text.trim()) {
        stmt.run(quote.text.trim());
        imported++;
      }
    });
    
    stmt.finalize();
    
    // Cleanup uploaded file
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

// Broadcasts
app.get('/broadcasts', (req, res) => {
  const d = db();
  d.all('SELECT * FROM broadcasts ORDER BY (type="weekly") DESC, id DESC LIMIT 100', (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.render('broadcasts', { title:'Рассылки', rows, pushModal: pushModalMarkup(), weeklyModal: weeklyModalMarkup(), imgModal: imgModalMarkup()});
  });
});

app.post('/broadcasts/push', (req, res) => {
  const { date, time, message, image } = req.body;
  if (!(date && time && message)) return res.redirect('/broadcasts');
  // Преобразуем локальное время администратора (по умолч. DEFAULT_TZ) в UTC ISO
  const localDt = DateTime.fromISO(`${date}T${time}`, { zone: DEFAULT_TZ });
  const iso = localDt.isValid ? localDt.toUTC().toISO() : `${date}T${time}:00Z`;
  const d = db();
  d.run('INSERT INTO broadcasts(type, schedule, message, image) VALUES ("push", ?, ?, ?)', [iso, message, image || null], () => {
    res.redirect('/broadcasts');
  });
});

app.post('/broadcasts/weekly', (req, res) => {
  const { day, time, message, image } = req.body;
  if (!(day && time && message)) return res.redirect('/broadcasts');
  const sched = `${day}|${time}`;
  const d = db();
  d.run('INSERT INTO broadcasts(type, schedule, message, image) VALUES ("weekly", ?, ?, ?)', [sched, message, image || null], () => {
    res.redirect('/broadcasts');
  });
});

// Update broadcast image
app.post('/broadcasts/update-image/:id', (req, res) => {
  const id = Number(req.params.id);
  let img = (req.body.image||'').trim();
  if (req.body.remove) img = null;
  const d = db();
  d.run('UPDATE broadcasts SET image = ? WHERE id = ?', [img || null, id], () => {
    res.redirect('/broadcasts');
  });
});

// Обновление текста рассылки
app.post('/broadcasts/edit/:id', (req, res) => {
  const id = Number(req.params.id);
  const message = (req.body.message || '').trim();
  if (!message) return res.redirect('/broadcasts');
  const d = db();
  d.run('UPDATE broadcasts SET message = ? WHERE id = ?', [message, id], () => {
    res.redirect('/broadcasts');
  });
});

// Удаление рассылки
app.post('/broadcasts/delete/:id', (req, res) => {
  const id = Number(req.params.id);
  const d = db();
  d.run('DELETE FROM broadcasts WHERE id = ?', [id], () => {
    res.redirect('/broadcasts');
  });
});

// ================= BOT PROCESS MANAGEMENT =================

function botStatus() {
  if (!botProcess) return 'stopped';
  return botProcess.killed ? 'stopped' : 'running';
}

function startBot() {
  if (botProcess) return false;
  botProcess = spawn('node', ['src/index.js'], { stdio: 'inherit' });
  botProcess.on('exit', () => {
    botProcess = null;
  });
  return true;
}

function stopBot(force = false) {
  if (!botProcess) return false;
  try {
    botProcess.kill(force ? 'SIGKILL' : 'SIGINT');
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

app.get('/bot', (req, res) => {
  const status = botStatus();
  res.render('bot', { title:'Бот', status, pid: botProcess ? botProcess.pid : null, currentToken: process.env.BOT_TOKEN || '' });
});

app.post('/bot/start', (req, res) => {
  const ok = startBot();
  res.redirect('/bot');
});

app.post('/bot/stop', (req, res) => {
  stopBot(false);
  res.redirect('/bot');
});

app.post('/bot/kill', (req, res) => {
  stopBot(true);
  res.redirect('/bot');
});

app.post('/bot/restart', (req, res) => {
  stopBot(false);
  setTimeout(() => {
    startBot();
  }, 500);
  res.redirect('/bot');
});

// Stop the admin panel itself
app.post('/panel/stop', (req, res) => {
  res.send('Панель выключается...');
  console.log('[ADMIN] Panel shutting down by user request');
  setTimeout(() => process.exit(0), 500);
});

// ================= CREDENTIALS MANAGEMENT =================
// GET-маршрут для страницы смены учетных данных
app.get('/change-credentials', (req, res) => {
  if (req.successMessage || req.errorMessage) {
    res.render('change-credentials', {
      title: 'Изменить учетные данные',
      adminUser: ADMIN_USER, // Передаем текущее имя пользователя для отображения
      success: req.successMessage,
      error: req.errorMessage
    });
  } else {
     res.render('change-credentials', {
      title: 'Изменить учетные данные',
      adminUser: ADMIN_USER, // Передаем текущее имя пользователя для отображения
    });
  }
});

// POST-маршрут для обработки смены учетных данных
app.post('/change-credentials', (req, res) => {
  const { currentPassword, newUsername: rawNewUsername, newPassword, confirmNewPassword } = req.body;
  let newUsername = rawNewUsername.trim();

  // 1. Проверка текущего пароля
  if (currentPassword !== ADMIN_PASS) {
    return res.render('change-credentials', {
      title: 'Изменить учетные данные',
      adminUser: ADMIN_USER,
      error: 'Текущий пароль введен неверно.'
    });
  }

  // 2. Валидация нового пароля
  const passwordValidation = credentialsManager.validateNewPassword(newPassword, confirmNewPassword);
  if (!passwordValidation.valid) {
    return res.render('change-credentials', {
      title: 'Изменить учетные данные',
      adminUser: ADMIN_USER,
      error: passwordValidation.error
    });
  }
  
  // Если новое имя пользователя не введено, используем старое
  if (!newUsername) {
    newUsername = ADMIN_USER;
  }

  // 3. Обновление учетных данных
  const result = credentialsManager.updateCredentials(currentPassword, newUsername, newPassword);
  
  if (result.success) {
    return res.render('change-credentials', {
      title: 'Учетные данные обновлены',
      adminUser: newUsername,
      success: result.message
    });
  } else {
    return res.render('change-credentials', {
      title: 'Изменить учетные данные',
      adminUser: ADMIN_USER,
      error: result.error
    });
  }
});

// Helper markup generators for broadcasts
function pushModalMarkup() {
  return `
<div class="modal fade" id="newPushModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-lg">
    <div class="modal-content">
      <form method="POST" action="/broadcasts/push">
        <div class="modal-header"><h5 class="modal-title">Новая PUSH рассылка</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="row g-2 mb-3">
            <div class="col"><input type="date" name="date" class="form-control" required></div>
            <div class="col"><input type="time" name="time" class="form-control" required></div>
          </div>
          <textarea name="message" class="form-control mb-2" rows="4" required placeholder="Сообщение..."></textarea>
          <input type="text" name="image" class="form-control" placeholder="Ссылка/ID картинки (опц.)" />
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button><button class="btn btn-primary">Добавить</button></div>
      </form>
    </div>
  </div>
</div>`;
}

function weeklyModalMarkup() {
  return `
<div class="modal fade" id="newWeeklyModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-lg">
    <div class="modal-content">
      <form method="POST" action="/broadcasts/weekly">
        <div class="modal-header"><h5 class="modal-title">Новая Weekly рассылка</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="row g-2 mb-3">
            <div class="col">
              <select name="day" class="form-select">
                <option value="1">Пн</option><option value="2">Вт</option><option value="3">Ср</option><option value="4">Чт</option><option value="5">Пт</option><option value="6">Сб</option><option value="7">Вс</option>
              </select>
            </div>
            <div class="col"><input type="time" name="time" class="form-control" required></div>
          </div>
          <textarea name="message" class="form-control mb-2" rows="4" required placeholder="Сообщение..."></textarea>
          <input type="text" name="image" class="form-control" placeholder="Ссылка/ID картинки (опц.)" />
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button><button class="btn btn-primary">Добавить</button></div>
      </form>
    </div>
  </div>
</div>`;
}

function imgModalMarkup() {
  return `
<div class="modal fade" id="imgModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog">
    <div class="modal-content">
      <form method="POST" id="imgForm" action="">
        <div class="modal-header"><h5 class="modal-title">Изображение рассылки</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="input-group mb-3">
            <input type="text" name="image" class="form-control" placeholder="URL или FileID" />
            <a id="imgOpen" class="btn btn-outline-secondary" href="#" target="_blank" style="display:none;">Открыть</a>
          </div>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button><button type="submit" name="remove" value="1" class="btn btn-danger">Удалить</button><button class="btn btn-primary">Сохранить</button></div>
      </form>
    </div>
  </div>
</div>`;
}

// ================= ADMINS =================
app.get('/admins', (req, res) => {
  const d = db();
  d.all('SELECT chat_id FROM admins WHERE chat_id IS NOT NULL ORDER BY chat_id', (err, tgRows) => {
    if (err) return res.status(500).send(err.message);
    d.all('SELECT username FROM web_admins ORDER BY username', (e2, webRows) => {
      if (e2) return res.status(500).send(e2.message);
      res.render('admins', { title:'Админы', tgAdmins: tgRows, webAdmins: webRows });
    });
  });
});

app.post('/admins', (req, res) => {
  const id = Number(req.body.chat_id);
  if (!id) return res.redirect('/admins');
  const d = db();
  d.run('INSERT OR IGNORE INTO admins(chat_id) VALUES (?)', [id], () => {
    res.redirect('/admins');
  });
});

app.post('/admins/delete/:id', (req, res) => {
  const id = Number(req.params.id);
  const d = db();
  d.run('DELETE FROM admins WHERE chat_id = ?', [id], () => {
    res.redirect('/admins');
  });
});

// Добавление/обновление веб-админа
app.post('/admins/web', (req, res) => {
  const { username, password } = req.body;
  if (!(username && password)) return res.redirect('/admins');
  const d = db();
  const saltRounds = 10;
  bcrypt.hash(password, saltRounds, (err, hash) => {
    if (err) return res.status(500).send(err.message);
    d.run('INSERT OR REPLACE INTO web_admins(username, password) VALUES (?, ?)', [username, hash], () => {
      res.redirect('/admins');
    });
  });
});

app.post('/admins/delete-web/:username', (req, res) => {
  const username = req.params.username;
  const d = db();
  d.run('DELETE FROM web_admins WHERE username = ?', [username], () => {
    res.redirect('/admins');
  });
});

// Маршруты аутентификации
app.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  res.render('login', { title: 'Вход', error: req.flash('error')[0] });
});

app.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login',
  failureFlash: true
}));

app.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/login');
  });
});

// ================= BOT TOKEN MANAGEMENT =================
// Обновление BOT_TOKEN через веб-интерфейс
app.post('/bot/update-token', (req, res) => {
  const newToken = (req.body.token || '').trim();
  if (!newToken) {
    return res.redirect('/bot');
  }

  // Читаем .env, обновляем/добавляем BOT_TOKEN
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  const lines = envContent.split(/\r?\n/).filter(Boolean);
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('BOT_TOKEN=')) {
      lines[i] = `BOT_TOKEN=${newToken}`;
      found = true;
      break;
    }
  }
  if (!found) {
    lines.push(`BOT_TOKEN=${newToken}`);
  }

  fs.writeFileSync(envPath, lines.join('\n'));
  process.env.BOT_TOKEN = newToken; // обновляем текущее окружение панели

  console.log('[ADMIN] BOT_TOKEN updated via panel');
  res.redirect('/bot');
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[ADMIN] Panel running on http://localhost:${PORT}`);
  });
}

module.exports = app; 