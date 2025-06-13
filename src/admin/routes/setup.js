const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { db: sharedDb } = require('../../core/db');
const { hasAnyWebAdmins } = require('../../core/auth');
const envManager = require('../../core/envManager');

function db() { return sharedDb; }

// Функция для создания или обновления .env файла
function createOrUpdateEnvFile(botToken) {
  if (!envManager.exists()) {
    // Создаем новый файл с базовыми настройками
    return envManager.createDefault(botToken) ? envManager.getPath() : null;
  } else {
    // Обновляем существующий файл только если передан токен
    if (botToken && botToken.trim()) {
      envManager.set('BOT_TOKEN', botToken.trim());
    }
    return envManager.getPath();
  }
}

// GET /setup - Страница первичной настройки
router.get('/setup', (req, res) => {
  // Проверяем, есть ли уже админы в системе
  hasAnyWebAdmins((err, hasAdmins) => {
    if (err) {
      console.error('[SETUP] Error checking web admins:', err);
      return res.status(500).send('Ошибка базы данных');
    }

    // Если админы уже есть, редиректим на главную
    if (hasAdmins) {
      return res.redirect('/');
    }

    // Показываем страницу первичной настройки
    res.render('setup', { 
      title: 'Первичная настройка', 
      error: req.query.error,
      success: req.query.success 
    });
  });
});

// POST /setup - Обработка первичной настройки
router.post('/setup', async (req, res) => {
  const { username, password, confirmPassword, botToken } = req.body;

  try {
    // Проверяем, есть ли уже админы в системе
    const hasAdminsPromise = new Promise((resolve, reject) => {
      hasAnyWebAdmins((err, hasAdmins) => {
        if (err) reject(err);
        else resolve(hasAdmins);
      });
    });

    const hasAdmins = await hasAdminsPromise;
    if (hasAdmins) {
      return res.redirect('/?error=' + encodeURIComponent('Система уже настроена'));
    }

    // Валидация данных
    if (!username || !password || !confirmPassword) {
      return res.redirect('/setup?error=' + encodeURIComponent('Все поля обязательны для заполнения'));
    }

    if (username.length < 3) {
      return res.redirect('/setup?error=' + encodeURIComponent('Имя пользователя должно быть не менее 3 символов'));
    }

    if (password.length < 8) {
      return res.redirect('/setup?error=' + encodeURIComponent('Пароль должен быть не менее 8 символов'));
    }

    if (!/(?=.*[a-z])/.test(password)) {
      return res.redirect('/setup?error=' + encodeURIComponent('Пароль должен содержать хотя бы одну строчную букву'));
    }

    if (!/(?=.*[A-Z])/.test(password)) {
      return res.redirect('/setup?error=' + encodeURIComponent('Пароль должен содержать хотя бы одну заглавную букву'));
    }

    if (!/(?=.*[0-9])/.test(password)) {
      return res.redirect('/setup?error=' + encodeURIComponent('Пароль должен содержать хотя бы одну цифру'));
    }

    if (!/(?=.*[^A-Za-z0-9])/.test(password)) {
      return res.redirect('/setup?error=' + encodeURIComponent('Пароль должен содержать хотя бы один специальный символ'));
    }

    if (password !== confirmPassword) {
      return res.redirect('/setup?error=' + encodeURIComponent('Пароли не совпадают'));
    }

    if (botToken && botToken.trim() && !/^[0-9]+:[A-Za-z0-9_-]+$/.test(botToken.trim())) {
      return res.redirect('/setup?error=' + encodeURIComponent('Неверный формат токена бота'));
    }

    // Хешируем пароль
    const hashedPassword = await bcrypt.hash(password, 10);

    // Создаем первого администратора
    const d = db();
    d.run('INSERT INTO web_admins (username, password, role) VALUES (?, ?, ?)', 
      [username.trim(), hashedPassword, 'super'], (err) => {
      if (err) {
        console.error('[SETUP] Error creating admin:', err);
        return res.redirect('/setup?error=' + encodeURIComponent('Ошибка создания администратора'));
      }

      console.log(`[SETUP] Создан первый администратор: ${username}`);

      // Создаем или обновляем .env файл
      try {
        const envPath = createOrUpdateEnvFile(botToken);
        console.log(`[SETUP] Создан/обновлен .env файл: ${envPath}`);
        
        let successMessage = 'Первичная настройка завершена! Создан файл .env с базовой конфигурацией.';
        if (botToken && botToken.trim()) {
          successMessage += ' Токен бота добавлен в конфигурацию.';
        } else {
          successMessage += ' Добавьте токен бота в файл .env для запуска бота.';
        }
        successMessage += ' Вы можете войти в систему.';

        res.redirect('/login?success=' + encodeURIComponent(successMessage));
      } catch (envError) {
        console.error('[SETUP] Error creating .env file:', envError);
        // Даже если .env не создался, админ создан, поэтому перенаправляем с предупреждением
        const warningMessage = 'Администратор создан, но не удалось создать файл .env. Создайте его вручную.';
        res.redirect('/login?success=' + encodeURIComponent(warningMessage));
      }
    });

  } catch (error) {
    console.error('[SETUP] Setup error:', error);
    res.redirect('/setup?error=' + encodeURIComponent('Произошла внутренняя ошибка сервера'));
  }
});

module.exports = router; 