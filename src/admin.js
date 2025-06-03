require('dotenv').config();

/*
 * Simple Admin Web Panel for Quote Bot
 * Uses basic HTTP auth; manage quotes and broadcasts.
 */

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const flash = require('connect-flash');
const fs = require('fs');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const { version } = require('../package.json');
const { db: sharedDb, initDatabase } = require('./core/db');
const { passport, isAuthenticated } = require('./core/auth');
const quotesRouter = require('./admin/routes/quotes');
const broadcastsRouter = require('./admin/routes/broadcasts');
const usersRouter = require('./admin/routes/users');
const adminsRouter = require('./admin/routes/admins');
const authRouter = require('./admin/routes/auth');
const botRouter = require('./admin/routes/bot');

const envPath = path.join(__dirname, '..', '.env');

const PORT = Number(process.env.ADMIN_PORT || 3000);
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin';

const app = express();

const avatarDirPath = path.join(__dirname, 'admin/public/uploads/avatars');
if (!fs.existsSync(avatarDirPath)) {
  fs.mkdirSync(avatarDirPath, { recursive: true });
}

// Static assets (logo, etc.)
app.use(express.static(path.join(__dirname, 'admin/public')));
app.use('/uploads/avatars', express.static(path.join(__dirname, 'admin/public/uploads/avatars'))); // Для аватарок

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
app.set('views', path.join(__dirname, 'admin/views'));
app.use(expressLayouts);          
app.set('layout', 'layout');      // общий шаблон

// Добавляем версию в локальные переменные для всех шаблонов
app.locals.version = version;

// Middleware: передаём имя текущего пользователя во все шаблоны
app.use((req, res, next) => {
  res.locals.currentUser = req.user ? req.user.username : null;
  res.locals.role = req.user ? req.user.role : null;
  res.locals.profilePicture = req.user ? req.user.profile_picture : null;
  next();
});

// Read-only guard for guest role: block any non-GET, non-logout actions
app.use((req, res, next) => {
  if (req.user && req.user.role === 'guest' && req.method !== 'GET') {
    // Разрешаем POST /logout гостю, чтобы мог выйти
    if (req.path === '/logout') return next();
    return res.status(403).send('Forbidden: read-only guest');
  }
  next();
});

// Глобальный middleware аутентификации
app.use(isAuthenticated);

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

// Quotes routes moved to dedicated router
app.use('/quotes', quotesRouter);

// Broadcast routes moved to dedicated router
app.use('/broadcasts', broadcastsRouter);

// Users routes moved to dedicated router
app.use('/users', usersRouter);

// Admin management routes
app.use('/admins', adminsRouter);

// Auth (login/logout)
app.use('/', authRouter);
app.use('/', botRouter);

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

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[ADMIN] Panel running on http://localhost:${PORT}`);
  });
}

module.exports = app; 