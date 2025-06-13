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
const expressLayouts = require('express-ejs-layouts');
const { version } = require('../package.json');
const { db: sharedDb, initDatabase } = require('./core/db');
const { passport, isAuthenticated, updateSessionActivity } = require('./core/auth');
const timeManager = require('./core/timeUtils');
const quotesRouter = require('./admin/routes/quotes');
const broadcastsRouter = require('./admin/routes/broadcasts');
const usersRouter = require('./admin/routes/users');
const adminsRouter = require('./admin/routes/admins');
const authRouter = require('./admin/routes/auth');
const botRouter = require('./admin/routes/bot');
const setupRouter = require('./admin/routes/setup');
const securityRouter = require('./admin/routes/security');
const statsRouter = require('./admin/routes/stats');
const searchRouter = require('./admin/routes/search');
const aiExplainerRouter = require('./admin/routes/aiExplainer');

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

// Trust proxy для корректного получения IP
app.set('trust proxy', true);

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'admin/views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Функции для получения статуса бота
function findBotProcess() {
  const { execSync } = require('child_process');
  try {
    const result = execSync("ps aux | grep 'node src/index.js' | grep -v grep", { encoding: 'utf8' });
    const lines = result.split('\n').filter(line => line.trim());
    
    if (lines.length > 0) {
      const pid = parseInt(lines[0].trim().split(/\s+/)[1]);
      if (pid && !isNaN(pid)) {
        return pid;
      }
    }
  } catch (error) {
    // Игнорируем ошибки - значит процесс не найден
  }
  return null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function getBotStatus() {
  const existingPid = findBotProcess();
  if (existingPid && isProcessAlive(existingPid)) {
    return 'running';
  }
  return 'stopped';
}

function getCurrentBotPid() {
  const existingPid = findBotProcess();
  if (existingPid && isProcessAlive(existingPid)) {
    return existingPid;
  }
  return null;
}

// Добавляем переменные для всех шаблонов
app.locals.version = version;
app.locals.getBotStatus = getBotStatus;
app.locals.getCurrentBotPid = getCurrentBotPid;

// Session middleware
app.use(session({
  store: new SQLiteStore({ 
    db: 'sessions.db',
    dir: __dirname + '/../'
  }),
  secret: process.env.SESSION_SECRET || 'super-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Для HTTPS должно быть true
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000 // 8 часов
  }
}));

// Flash messages
app.use(flash());

// Парсинг urlencoded до инициализации passport
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Middleware для обновления активности сессии
app.use(updateSessionActivity);

// Middleware для добавления пользователя в locals
app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  res.locals.isAuthenticated = req.isAuthenticated() || false;
  res.locals.timeManager = timeManager;
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

// Инициализация базы данных
initDatabase();

// Routes
app.use('/', authRouter);
app.use('/setup', setupRouter);
app.use('/quotes', isAuthenticated, quotesRouter);
app.use('/broadcasts', isAuthenticated, broadcastsRouter);
app.use('/users', isAuthenticated, usersRouter);
app.use('/admins', isAuthenticated, adminsRouter);
app.use('/bot', isAuthenticated, botRouter);
app.use('/security', isAuthenticated, securityRouter);
app.use('/stats', isAuthenticated, statsRouter);
app.use('/search', isAuthenticated, searchRouter);
app.use('/ai-explainer', isAuthenticated, aiExplainerRouter);

// Statistics page (main dashboard)
app.get('/', isAuthenticated, (req, res) => {
  const db = sharedDb;
  
  // Получаем статистику
  db.get('SELECT COUNT(*) as count FROM quotes', (err1, quotesResult) => {
    if (err1) {
      console.error('[ADMIN] Error getting quotes count:', err1);
      return res.status(500).render('error', { 
        title: 'Ошибка', 
        error: 'Ошибка загрузки статистики цитат',
        code: 500
      });
    }

    db.get('SELECT COUNT(*) as count FROM users', (err2, usersResult) => {
      if (err2) {
        console.error('[ADMIN] Error getting users count:', err2);
        return res.status(500).render('error', { 
          title: 'Ошибка', 
          error: 'Ошибка загрузки статистики пользователей',
          code: 500
        });
      }

      db.get('SELECT COUNT(*) as count FROM broadcasts', (err3, broadcastsResult) => {
        if (err3) {
          console.error('[ADMIN] Error getting broadcasts count:', err3);
          return res.status(500).render('error', { 
            title: 'Ошибка', 
            error: 'Ошибка загрузки статистики рассылок',
            code: 500
          });
        }

        // Рендерим страницу статистики
        res.render('dashboard', { 
          title: 'Статистика',
          quotes: quotesResult.count,
          users: usersResult.count,
          broadcasts: broadcastsResult.count
        });
      });
    });
  });
});

// Dashboard (main panel)
app.get('/dashboard', isAuthenticated, (req, res) => {
  res.render('index', { 
    title: 'Главная панель',
    user: req.user
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).render('error', { 
    title: 'Страница не найдена',
    error: 'Запрашиваемая страница не существует',
    code: 404
  });
});

// Handle errors
app.use((err, req, res, next) => {
  console.error('[ADMIN] Error:', err);
  res.status(500).render('error', { 
    title: 'Ошибка сервера',
    error: 'Внутренняя ошибка сервера',
    code: 500
  });
});

// Запуск сервера с красивой обработкой ошибок
const server = app.listen(PORT, () => {
  console.log('');
  console.log('🕊️  ══════════════════════════════════════════════════════════');
  console.log(`✅ Веб-панель Bahai Quote Bot успешно запущена!`);
  console.log('🕊️  ══════════════════════════════════════════════════════════');
  console.log(`🌐 Адрес панели: http://localhost:${PORT}`);
  console.log(`📂 Рабочая папка: ${__dirname}`);
  console.log(`⏰ Время запуска: ${new Date().toLocaleString('ru-RU')}`);
  console.log('');
  console.log('💡 Инструкции:');
  console.log('   • Откройте браузер и перейдите по указанному адресу');
  console.log('   • При первом входе создайте администратора');
  console.log('   • Для остановки нажмите Ctrl+C');
  console.log('');
  console.log('🕊️  ══════════════════════════════════════════════════════════');
  console.log('');
});

server.on('error', (err) => {
  console.log('');
  console.log('🕊️  ══════════════════════════════════════════════════════════');
  console.log('❌ Ошибка запуска веб-панели');
  console.log('🕊️  ══════════════════════════════════════════════════════════');
  
  if (err.code === 'EADDRINUSE') {
    console.log(`🚫 Порт ${PORT} уже используется другим приложением!`);
    console.log('');
    console.log('🔧 Решения:');
    console.log('   1. Остановите приложение, использующее порт ' + PORT);
    console.log('   2. Измените порт в файле .env:');
    console.log(`      ADMIN_PORT=3001`);
    console.log('   3. Или найдите процесс и завершите его:');
    console.log(`      sudo lsof -i :${PORT}`);
    console.log(`      sudo kill -9 <PID>`);
    console.log('');
    console.log('💡 Часто порт 3000 используют:');
    console.log('   • Node.js приложения (React, Next.js)');
    console.log('   • Другие веб-серверы');
    console.log('   • Grafana, Jenkins и другие инструменты');
  } else if (err.code === 'EACCES') {
    console.log(`🔒 Нет доступа к порту ${PORT}!`);
    console.log('');
    console.log('🔧 Решения:');
    console.log('   1. Запустите с правами администратора:');
    console.log('      sudo npm run admin-web');
    console.log('   2. Или используйте порт больше 1024:');
    console.log('      Измените ADMIN_PORT в .env на 3001 или выше');
  } else {
    console.log(`🔥 Неизвестная ошибка: ${err.message}`);
    console.log('   Код ошибки:', err.code);
  }
  
  console.log('');
  console.log('📞 Нужна помощь? Обратитесь к: andrei.gomonov.md@gmail.com');
  console.log('🕊️  ══════════════════════════════════════════════════════════');
  console.log('');
  
  process.exit(1);
});

module.exports = app; 