const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const { db } = require('./db'); // Путь останется таким же, так как auth.js и db.js будут в core
const securityManager = require('./security');

// Функция для проверки наличия веб-админов в системе
function hasAnyWebAdmins(callback) {
  db.get('SELECT COUNT(*) as count FROM web_admins', (err, row) => {
    if (err) return callback(err, false);
    callback(null, row.count > 0);
  });
}

// Настройка сериализации пользователя
passport.serializeUser((user, done) => {
  done(null, user.username);
});

passport.deserializeUser((username, done) => {
  db.get('SELECT role, profile_picture, last_login_at FROM web_admins WHERE username = ?', [username], (err, row) => {
    if (err) return done(err);
    done(null, { 
      username, 
      role: row?.role || 'admin', 
      profile_picture: row?.profile_picture || null,
      last_login_at: row?.last_login_at || null
    });
  });
});

// Настройка локальной стратегии с улучшенной безопасностью
passport.use(new LocalStrategy({
  passReqToCallback: true // Важно: включаем передачу req
}, (req, username, password, done) => {
    const isTest = process.env.NODE_ENV === 'test';

    // В тестовом режиме всегда пускаем admin/admin
    if (isTest) {
      if (username === 'admin' && password === 'admin') {
        return done(null, { username });
      }
      return done(null, false, { message: 'Неверное имя пользователя или пароль (test)' });
    }

    // Получаем IP и User-Agent из req
    const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    // Проверяем блокировку по IP
    const ipLockStatus = securityManager.isIpLocked(ip);
    if (ipLockStatus && ipLockStatus.locked) {
      securityManager.recordLoginAttempt(username, ip, userAgent, false, true);
      return done(null, false, { 
        message: `IP-адрес заблокирован на ${ipLockStatus.remainingTime} минут. Слишком много неудачных попыток входа.` 
      });
    }

    // Проверяем блокировку пользователя
    const userLockStatus = securityManager.isUserLocked(username);
    if (userLockStatus && userLockStatus.locked) {
      securityManager.recordLoginAttempt(username, ip, userAgent, false, true);
      return done(null, false, { 
        message: `Пользователь заблокирован на ${userLockStatus.remainingTime} минут. Слишком много неудачных попыток входа.` 
      });
    }

    // Сначала пытаемся найти пользователя в БД
    db.get('SELECT password, role FROM web_admins WHERE username = ?', [username], (err, row) => {
      if (err) {
        securityManager.recordLoginAttempt(username, ip, userAgent, false);
        return done(err);
      }

      if (row && row.password) {
        // Сравниваем хеш в базе с вводом
        bcrypt.compare(password, row.password, (err2, same) => {
          if (err2) {
            securityManager.recordLoginAttempt(username, ip, userAgent, false);
            return done(err2);
          }
          
          if (same) {
            // Успешный вход
            securityManager.recordLoginAttempt(username, ip, userAgent, true);
            return done(null, { username, role: row.role || 'admin' });
          }
          
          // Неверный пароль
          securityManager.recordLoginAttempt(username, ip, userAgent, false);
          return done(null, false, { message: 'Неверное имя пользователя или пароль' });
        });
        return; // ждём compare
      }

      // Пользователь не найден
      securityManager.recordLoginAttempt(username, ip, userAgent, false);
      return done(null, false, { message: 'Неверное имя пользователя или пароль' });
    });
  }
));

// Middleware для обновления активности сессии
const updateSessionActivity = (req, res, next) => {
  if (req.isAuthenticated() && req.sessionID) {
    securityManager.updateSessionActivity(req.sessionID);
  }
  next();
};

// Улучшенный middleware для проверки аутентификации
const isAuthenticated = (req, res, next) => {
  // Разрешаем свободный доступ к странице логина, логаута, setup и статике
  const openPaths = ['/login', '/logout', '/setup'];
  if (openPaths.includes(req.path) || req.path.startsWith('/uploads/')) {
    return next();
  }

  // Проверяем, есть ли веб-админы в системе
  hasAnyWebAdmins((err, hasAdmins) => {
    if (err) {
      console.error('[AUTH] Error checking web admins:', err);
      return res.status(500).send('Database error');
    }

    // Если нет админов, редиректим на страницу первичной настройки
    if (!hasAdmins) {
      return res.redirect('/setup');
    }

    // Если есть админы, требуем аутентификацию
    if (req.isAuthenticated()) {
      // Проверяем валидность сессии в базе данных
      if (req.sessionID) {
        securityManager.isSessionValid(req.sessionID, (err, isValid) => {
          if (err) {
            console.error('[AUTH] Session validation error:', err);
            return res.redirect('/login?error=' + encodeURIComponent('Ошибка проверки сессии'));
          }
          
          if (!isValid) {
            req.logout((logoutErr) => {
              if (logoutErr) console.error('[AUTH] Logout error:', logoutErr);
              return res.redirect('/login?error=' + encodeURIComponent('Сессия истекла, необходимо войти заново'));
            });
            return;
          }
          
          // Обновляем активность сессии
          securityManager.updateSessionActivity(req.sessionID);
          return next();
        });
      } else {
        return next();
      }
    } else {
      return res.redirect('/login');
    }
  });
};

// Middleware для создания сессии после успешного логина
const createSecureSession = (req, res, next) => {
  if (req.isAuthenticated() && req.sessionID && req.user) {
    const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    securityManager.createSession(req.sessionID, req.user.username, ip, userAgent);
  }
  next();
};

// Middleware для уничтожения сессии при выходе
const destroySecureSession = (req, res, next) => {
  if (req.sessionID) {
    securityManager.destroySession(req.sessionID);
  }
  next();
};

// Функция для получения статистики безопасности (для админов)
function getSecurityStats(callback) {
  securityManager.getSecurityStats(callback);
}

// Функция для разблокировки пользователя
function unlockUser(username) {
  securityManager.unlockUser(username);
}

// Функция для принудительного выхода всех сессий пользователя
function logoutAllSessions(username) {
  securityManager.logoutAllSessions(username);
}

module.exports = {
  passport,
  isAuthenticated,
  hasAnyWebAdmins,
  updateSessionActivity,
  createSecureSession,
  destroySecureSession,
  getSecurityStats,
  unlockUser,
  logoutAllSessions,
  securityManager
}; 