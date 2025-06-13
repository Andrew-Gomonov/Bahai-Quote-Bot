const express = require('express');
const router = express.Router();
const { getSecurityStats, unlockUser, logoutAllSessions, securityManager } = require('../../core/auth');

// Middleware: только супер-админы могут просматривать безопасность
function requireSuper(req, res, next) {
  if (req.user && req.user.role === 'super') return next();
  return res.status(403).send('Forbidden: Только супер-администраторы могут управлять безопасностью');
}

// Главная страница безопасности
router.get('/', requireSuper, (req, res) => {
  getSecurityStats((err, stats) => {
    if (err) {
      console.error('[SECURITY] Error getting stats:', err);
      req.flash('error', 'Ошибка загрузки статистики безопасности');
      return res.redirect('/');
    }
    
    res.render('security', {
      title: 'Безопасность системы',
      stats,
      success: req.flash('success')[0] || req.query.success,
      error: req.flash('error')[0] || req.query.error
    });
  });
});

// Разблокировка пользователя
router.post('/unlock-user', requireSuper, (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    req.flash('error', 'Имя пользователя не указано');
    return res.redirect('/security');
  }
  
  try {
    unlockUser(username.trim());
    req.flash('success', `Пользователь ${username} успешно разблокирован`);
    console.log(`[SECURITY] 🔓 User ${username} unlocked by ${req.user.username}`);
  } catch (error) {
    console.error('[SECURITY] Error unlocking user:', error);
    req.flash('error', 'Ошибка разблокировки пользователя');
  }
  
  res.redirect('/security');
});

// Принудительный выход всех сессий пользователя
router.post('/logout-all/:username', requireSuper, (req, res) => {
  const username = req.params.username;
  
  if (!username) {
    req.flash('error', 'Имя пользователя не указано');
    return res.redirect('/security');
  }
  
  try {
    logoutAllSessions(username);
    req.flash('success', `Все сессии пользователя ${username} завершены`);
    console.log(`[SECURITY] 🚪 All sessions terminated for ${username} by ${req.user.username}`);
  } catch (error) {
    console.error('[SECURITY] Error terminating sessions:', error);
    req.flash('error', 'Ошибка завершения сессий');
  }
  
  res.redirect('/security');
});

// API для получения статистики безопасности (для AJAX)
router.get('/api/stats', requireSuper, (req, res) => {
  getSecurityStats((err, stats) => {
    if (err) {
      console.error('[SECURITY] Error getting stats:', err);
      return res.status(500).json({ error: 'Ошибка загрузки статистики' });
    }
    
    res.json(stats);
  });
});

// Очистка старых логов (ручная)
router.post('/cleanup', requireSuper, (req, res) => {
  try {
    securityManager.cleanup();
    req.flash('success', 'Очистка логов безопасности выполнена успешно');
    console.log(`[SECURITY] 🧹 Manual cleanup performed by ${req.user.username}`);
  } catch (error) {
    console.error('[SECURITY] Error during cleanup:', error);
    req.flash('error', 'Ошибка очистки логов');
  }
  
  res.redirect('/security');
});

module.exports = router; 