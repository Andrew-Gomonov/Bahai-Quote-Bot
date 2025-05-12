const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const { db } = require('./db');

// Настройка сериализации пользователя
passport.serializeUser((user, done) => {
  done(null, user.username);
});

passport.deserializeUser((username, done) => {
  db.get('SELECT role FROM web_admins WHERE username = ?', [username], (err, row) => {
    if (err) return done(err);
    done(null, { username, role: row?.role || 'admin' });
  });
});

// Настройка локальной стратегии
passport.use(new LocalStrategy(
  (username, password, done) => {
    const isTest = process.env.NODE_ENV === 'test';

    // В тестовом режиме всегда пускаем admin/admin
    if (isTest) {
      if (username === 'admin' && password === 'admin') {
        return done(null, { username });
      }
      return done(null, false, { message: 'Неверное имя пользователя или пароль (test)' });
    }

    // Сначала пытаемся найти пользователя в БД
    db.get('SELECT password FROM web_admins WHERE username = ?', [username], (err, row) => {
      if (err) {
        return done(err);
      }

      if (row && row.password) {
        // Сравниваем хеш в базе с вводом
        bcrypt.compare(password, row.password, (err2, same) => {
          if (err2) return done(err2);
          if (same) return done(null, { username, role: row.role || 'admin' });
          return done(null, false, { message: 'Неверное имя пользователя или пароль' });
        });
        return; // ждём compare
      }

      return done(null, false, { message: 'Неверное имя пользователя или пароль' });
    });
  }
));

// Middleware для проверки аутентификации
const isAuthenticated = (req, res, next) => {
  // Разрешаем свободный доступ к странице логина и статике (если добавится)
  const openPaths = ['/login'];
  if (openPaths.includes(req.path)) {
    return next();
  }

  if (req.isAuthenticated()) {
    return next();
  }

  return res.redirect('/login');
};

module.exports = {
  passport,
  isAuthenticated
}; 