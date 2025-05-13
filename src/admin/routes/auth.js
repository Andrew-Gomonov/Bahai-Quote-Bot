const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { db: sharedDb } = require('../../core/db'); // Потребуется для работы с БД
const { passport } = require('../../core/auth');

function db() { return sharedDb; }

// Login page
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  // `flash` middleware already in app; get first error message
  res.render('login', { title: 'Вход', error: req.flash('error')[0] });
});

// Login POST
router.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login',
  failureFlash: true
}));

// Logout
router.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/login');
  });
});

// Change credentials page - GET
router.get('/change-credentials', (req, res) => {
  if (!req.isAuthenticated()) { // Должен быть залогинен, чтобы менять свои данные
    return res.redirect('/login');
  }
  res.render('change-credentials', {
    title: 'Изменить свои учетные данные',
    adminUser: req.user.username, // Имя текущего залогиненного веб-админа
    error: req.flash('error')[0],
    success: req.flash('success')[0]
  });
});

// Change credentials page - POST
router.post('/change-credentials', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/login');
  }

  const { currentPassword, newUsername, newPassword, confirmNewPassword } = req.body;
  const currentAdminUsername = req.user.username;

  if (!currentPassword) {
    req.flash('error', 'Текущий пароль обязателен.');
    return res.redirect('/change-credentials');
  }

  try {
    const d = db();
    d.get('SELECT * FROM web_admins WHERE username = ?', [currentAdminUsername], async (err, admin) => {
      if (err) {
        console.error('[ADMIN] DB Error fetching admin for cred change:', err);
        req.flash('error', 'Ошибка базы данных при поиске администратора.');
        return res.redirect('/change-credentials');
      }
      if (!admin) {
        req.flash('error', 'Не удалось найти текущего администратора. Попробуйте войти снова.');
        return res.redirect('/login');
      }

      const passwordMatch = await bcrypt.compare(currentPassword, admin.password);
      if (!passwordMatch) {
        req.flash('error', 'Текущий пароль введен неверно.');
        return res.redirect('/change-credentials');
      }

      let finalUsername = admin.username;
      let newHashedPassword = admin.password;
      let changesMade = false;

      if (newUsername && newUsername.trim() !== admin.username) {
        // Проверка, не занято ли новое имя пользователя другим админом
        const existingUser = await new Promise((resolve, reject) => {
          d.get('SELECT username FROM web_admins WHERE username = ? AND username != ?', 
                [newUsername.trim(), currentAdminUsername], (e, row) => e ? reject(e) : resolve(row));
        });
        if (existingUser) {
          req.flash('error', 'Новое имя пользователя уже занято другим администратором.');
          return res.redirect('/change-credentials');
        }
        finalUsername = newUsername.trim();
        changesMade = true;
      }

      if (newPassword) {
        if (newPassword.length < 8) {
          req.flash('error', 'Новый пароль должен быть не менее 8 символов.');
          return res.redirect('/change-credentials');
        }
        if (!/(?=.*[a-z])/.test(newPassword)) {
          req.flash('error', 'Новый пароль должен содержать хотя бы одну строчную букву (a-z).');
          return res.redirect('/change-credentials');
        }
        if (!/(?=.*[A-Z])/.test(newPassword)) {
          req.flash('error', 'Новый пароль должен содержать хотя бы одну заглавную букву (A-Z).');
          return res.redirect('/change-credentials');
        }
        if (!/(?=.*[0-9])/.test(newPassword)) {
          req.flash('error', 'Новый пароль должен содержать хотя бы одну цифру (0-9).');
          return res.redirect('/change-credentials');
        }
        if (!/(?=.*[^A-Za-z0-9])/.test(newPassword)) {
          req.flash('error', 'Новый пароль должен содержать хотя бы один специальный символ (например, !@#$%^&*).');
          return res.redirect('/change-credentials');
        }
        if (newPassword !== confirmNewPassword) {
          req.flash('error', 'Новый пароль и его подтверждение не совпадают.');
          return res.redirect('/change-credentials');
        }
        newHashedPassword = await bcrypt.hash(newPassword, 10);
        changesMade = true;
      }

      if (!changesMade) {
        req.flash('success', 'Изменений не было внесено.'); // или info, если есть такой тип
        return res.redirect('/change-credentials');
      }
      
      // Обновляем в БД
      d.run('UPDATE web_admins SET username = ?, password = ? WHERE username = ?', 
            [finalUsername, newHashedPassword, currentAdminUsername], (updateErr) => {
        if (updateErr) {
          console.error('[ADMIN] DB Error updating credentials:', updateErr);
          req.flash('error', 'Ошибка базы данных при обновлении учетных данных.');
          return res.redirect('/change-credentials');
        }

        // Если имя пользователя или пароль изменены, нужно разлогинить
        // и попросить войти снова с новыми данными.
        req.logout(() => {
          req.flash('success', 'Учетные данные успешно обновлены! Пожалуйста, войдите снова с новыми данными.');
          res.redirect('/login');
        });
      });
    });
  } catch (e) {
    console.error('[ADMIN] Error in /change-credentials POST:', e);
    req.flash('error', 'Произошла внутренняя ошибка сервера.');
    res.redirect('/change-credentials');
  }
});

module.exports = router; 