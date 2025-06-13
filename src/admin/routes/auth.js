const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { db: sharedDb } = require('../../core/db'); // Потребуется для работы с БД
const { passport, createSecureSession, destroySecureSession, securityManager } = require('../../core/auth');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

function db() { return sharedDb; }

const avatarDir = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dirPath = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    cb(null, dirPath);
  },
  filename: (req, file, cb) => {
    // Clean the username to make it safe for filesystem
    const username = req.user ? req.user.username : 'unknown';
    const cleanUsername = username.replace(/[^a-zA-Z0-9]/g, '_');
    const timestamp = Date.now();
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${cleanUsername}_${timestamp}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept only image files
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter });

// Login page
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  
  // Проверяем блокировку IP
  const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
  const ipLockStatus = securityManager.isIpLocked(ip);
  let lockMessage = '';
  
  if (ipLockStatus && ipLockStatus.locked) {
    lockMessage = `IP-адрес заблокирован на ${ipLockStatus.remainingTime} минут из-за множественных неудачных попыток входа.`;
  }
  
  res.render('login', { 
    title: 'Вход', 
    error: req.flash('error')[0] || req.query.error || lockMessage,
    success: req.flash('success')[0] || req.query.success,
    lockMessage
  });
});

// Login POST с улучшенной безопасностью
router.post('/login', (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
  
  // Проверяем блокировку IP перед попыткой входа
  const ipLockStatus = securityManager.isIpLocked(ip);
  if (ipLockStatus && ipLockStatus.locked) {
    req.flash('error', `IP-адрес заблокирован на ${ipLockStatus.remainingTime} минут. Слишком много неудачных попыток входа.`);
    return res.redirect('/login');
  }
  
  // Проверяем блокировку пользователя
  const username = req.body.username;
  if (username) {
    const userLockStatus = securityManager.isUserLocked(username);
    if (userLockStatus && userLockStatus.locked) {
      req.flash('error', `Пользователь заблокирован на ${userLockStatus.remainingTime} минут. Слишком много неудачных попыток входа.`);
      return res.redirect('/login');
    }
  }
  
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      console.error('[AUTH] Authentication error:', err);
      req.flash('error', 'Ошибка аутентификации');
      return res.redirect('/login');
    }
    
    if (!user) {
      req.flash('error', info?.message || 'Неверное имя пользователя или пароль');
      return res.redirect('/login');
    }
    
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error('[AUTH] Login error:', loginErr);
        req.flash('error', 'Ошибка входа в систему');
        return res.redirect('/login');
      }
      
      // Создаем безопасную сессию
      createSecureSession(req, res, () => {
        console.log(`[AUTH] ✅ Пользователь ${user.username} успешно вошел с ${ip}`);
        res.redirect('/');
      });
    });
  })(req, res, next);
});

// Logout with session cleanup (both GET and POST for compatibility)
router.get('/logout', (req, res, next) => {
  // Destroy the session
  req.logout((err) => {
    if (err) {
      console.error('[AUTH] Logout error:', err);
      return next(err);
    }
    res.redirect('/login');
  });
});

router.post('/logout', (req, res, next) => {
  const username = req.user ? req.user.username : 'unknown';
  
  destroySecureSession(req, res, () => {
    req.logout((err) => {
      if (err) {
        console.error('[AUTH] Logout error:', err);
        return next(err);
      }
      
      req.session.destroy((sessionErr) => {
        if (sessionErr) {
          console.error('[AUTH] Session destroy error:', sessionErr);
        }
        
        console.log(`[AUTH] 🚪 User ${username} logged out`);
        res.redirect('/login?success=' + encodeURIComponent('Вы успешно вышли из системы'));
      });
    });
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
    profilePicture: req.user.profile_picture || null, // Добавляем профильную картинку
    error: req.flash('error')[0],
    success: req.flash('success')[0]
  });
});

// Change credentials page - POST
router.post('/change-credentials', upload.single('profile_picture'), async (req, res) => {
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
      let finalProfilePic = admin.profile_picture;
      let changesMade = false;
      let credsChanged = false;

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
        credsChanged = true;
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
        credsChanged = true;
      }

      // Handle profile picture upload
      if (req.file) {
        const relPath = '/uploads/avatars/' + req.file.filename;
        // Remove old file if exists and different
        if (admin.profile_picture && admin.profile_picture !== relPath) {
          const oldPath = path.join(__dirname, '..', 'public', admin.profile_picture);
          if (fs.existsSync(oldPath)) {
            fs.unlink(oldPath, () => {});
          }
        }
        finalProfilePic = relPath;
        changesMade = true;
      }

      if (!changesMade) {
        req.flash('success', 'Изменений не было внесено.');
        return res.redirect('/change-credentials');
      }

      d.run('UPDATE web_admins SET username = ?, password = ?, profile_picture = ? WHERE username = ?',
            [finalUsername, newHashedPassword, finalProfilePic, currentAdminUsername], (updateErr) => {
        if (updateErr) {
          console.error('[ADMIN] DB Error updating credentials:', updateErr);
          req.flash('error', 'Ошибка базы данных при обновлении учетных данных.');
          return res.redirect('/change-credentials');
        }

        if (credsChanged) {
          // Обновляем сессию, чтобы не выкидывать пользователя после изменения логина/пароля
          const newUserObj = { username: finalUsername, role: admin.role, profile_picture: finalProfilePic };
          req.login(newUserObj, (loginErr) => {
            if (loginErr) {
              console.error('[ADMIN] Error during re-login after credential change:', loginErr);
              req.flash('error', 'Учетные данные обновлены, но произошла ошибка при обновлении сессии. Пожалуйста, войдите снова.');
              return res.redirect('/login');
            }
            // Обновляем объект req.user для текущего запроса
            req.user.username = finalUsername;
            req.user.profile_picture = finalProfilePic;
            req.flash('success', 'Учетные данные успешно обновлены! Вы остались в системе.');
            return res.redirect('/change-credentials');
          });
        } else {
          // Только аватарка – остаёмся в сессии
          req.user.profile_picture = finalProfilePic;
          req.flash('success', 'Аватарка успешно обновлена!');
          res.redirect('/change-credentials');
        }
      });
    });
  } catch (e) {
    console.error('[ADMIN] Error in /change-credentials POST:', e);
    req.flash('error', 'Произошла внутренняя ошибка сервера.');
    res.redirect('/change-credentials');
  }
});

// Error handler for multer size limit
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    req.flash('error', 'Файл слишком большой. Максимум 10 МБ.');
    return res.redirect('/change-credentials');
  }
  next(err);
});

module.exports = router; 