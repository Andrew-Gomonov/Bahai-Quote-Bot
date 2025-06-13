const express = require('express');
const router = express.Router();

const { spawn } = require('child_process');
const { DateTime } = require('luxon');
const envManager = require('../../core/envManager');

// Удаляем неиспользуемую переменную - будем использовать envManager.getPath()

let botProcess = null;

// Система логирования действий
let actionLogs = [];
const MAX_LOGS = 10; // Максимум 10 записей в логе

function addActionLog(action, status, details = '') {
  const timestamp = DateTime.now().setZone('Europe/Chisinau').toFormat('dd.MM.yyyy HH:mm:ss');
  const logEntry = {
    id: Date.now(),
    timestamp,
    action,
    status, // 'success', 'error', 'info'
    details,
    pid: getCurrentBotPid()
  };
  
  // Добавляем в начало массива
  actionLogs.unshift(logEntry);
  
  // Ограничиваем количество записей
  if (actionLogs.length > MAX_LOGS) {
    actionLogs = actionLogs.slice(0, MAX_LOGS);
  }
  
  console.log(`[ACTION LOG] ${action} - ${status}: ${details}`);
}

function getActionLogs() {
  return actionLogs;
}

// Инициализация лога при запуске модуля
addActionLog('Запуск панели', 'info', 'Веб-панель администратора запущена');

// Функция для поиска существующих процессов бота
function findBotProcess() {
  const { execSync } = require('child_process');
  try {
    // Ищем процесс по имени файла и команде
    const result = execSync("ps aux | grep 'node src/index.js' | grep -v grep", { encoding: 'utf8' });
    const lines = result.split('\n').filter(line => line.trim());
    
    if (lines.length > 0) {
      // Извлекаем PID из первой строки
      const pid = parseInt(lines[0].trim().split(/\s+/)[1]);
      if (pid && !isNaN(pid)) {
        console.log(`[ADMIN] Найден существующий процесс бота с PID: ${pid}`);
        return pid;
      }
    }
  } catch (error) {
    // Игнорируем ошибки - значит процесс не найден
  }
  return null;
}

// Функция для проверки активности процесса по PID
function isProcessAlive(pid) {
  try {
    // process.kill(pid, 0) не убивает процесс, а только проверяет его существование
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

// Система уведомлений администраторов
async function notifyAdmins(message) {
  try {
    // Проверяем, включены ли уведомления
    const notificationsEnabled = envManager.get('ADMIN_NOTIFICATIONS', 'true') === 'true';
    if (!notificationsEnabled) {
      console.log('[ADMIN] Уведомления отключены в настройках');
      return;
    }
    
    const TelegramBot = require('node-telegram-bot-api');
    const botToken = envManager.get('BOT_TOKEN');
    
    if (!botToken) {
      console.log('[ADMIN] Не удалось отправить уведомление: токен бота не найден');
      return;
    }

    // Создаем временного бота только для отправки уведомлений
    const notificationBot = new TelegramBot(botToken);
    
    // Получаем список администраторов из базы данных с включенными уведомлениями
    const { db } = require('../../core/db');
    
    db.all('SELECT chat_id FROM admins WHERE notifications_enabled = 1', (err, rows) => {
      if (err) {
        console.error('[ADMIN] Ошибка при получении списка администраторов:', err);
        return;
      }
      
      if (!rows || rows.length === 0) {
        console.log('[ADMIN] Нет администраторов с включенными уведомлениями');
        return;
      }
      
      // Отправляем уведомление каждому администратору с включенными уведомлениями
      rows.forEach(admin => {
        const timestamp = DateTime.now().setZone('Europe/Chisinau').toFormat('dd.MM.yyyy HH:mm:ss');
        const fullMessage = `🤖 **Уведомление от админ-панели**\n\n${message}\n\n⏰ ${timestamp}`;
        
        notificationBot.sendMessage(admin.chat_id, fullMessage, { parse_mode: 'Markdown' })
          .then(() => {
            console.log(`[ADMIN] Уведомление отправлено администратору ${admin.chat_id}`);
          })
          .catch(error => {
            console.error(`[ADMIN] Ошибка отправки уведомления администратору ${admin.chat_id}:`, error.message);
          });
      });
    });
    
  } catch (error) {
    console.error('[ADMIN] Ошибка системы уведомлений:', error.message);
  }
}

function botStatus() {
  // Сначала проверяем наш отслеживаемый процесс
  if (botProcess) {
    if (botProcess.killed) {
      botProcess = null;
      return 'stopped';
    }
    return 'running';
  }
  
  // Если наш процесс не отслеживается, ищем существующие
  const existingPid = findBotProcess();
  if (existingPid && isProcessAlive(existingPid)) {
    return 'running';
  }
  
  return 'stopped';
}

function getCurrentBotPid() {
  // Сначала проверяем наш отслеживаемый процесс
  if (botProcess && !botProcess.killed) {
    return botProcess.pid;
  }
  
  // Если наш процесс не отслеживается, ищем существующие
  const existingPid = findBotProcess();
  if (existingPid && isProcessAlive(existingPid)) {
    return existingPid;
  }
  
  return null;
}

function startBot() {
  // Проверяем, не запущен ли уже бот
  const existingPid = findBotProcess();
  if (existingPid && isProcessAlive(existingPid)) {
    console.log(`[ADMIN] Бот уже запущен с PID: ${existingPid}`);
    addActionLog('Запуск бота', 'error', `Бот уже запущен с PID: ${existingPid}`);
    return false;
  }
  
  if (botProcess && !botProcess.killed) {
    console.log('[ADMIN] Бот уже отслеживается в админ-панели');
    addActionLog('Запуск бота', 'error', 'Бот уже отслеживается в админ-панели');
    return false;
  }
  
  console.log('[ADMIN] Запуск бота...');
  addActionLog('Запуск бота', 'info', 'Инициализация процесса...');
  notifyAdmins('🚀 **Бот запускается...**\n\nИнициализация процесса бота через админ-панель.');
  
  botProcess = spawn('node', ['src/index.js'], { 
    stdio: 'inherit',
    detached: false
  });
  
  console.log(`[ADMIN] Бот запущен с PID: ${botProcess.pid}`);
  addActionLog('Запуск бота', 'success', `Процесс запущен с PID: ${botProcess.pid}`);
  
  botProcess.on('exit', (code) => {
    const exitMessage = code === 0 
      ? '✅ **Бот корректно завершил работу**\n\nПроцесс завершился с кодом 0.'
      : `⚠️ **Бот завершился с ошибкой**\n\nКод выхода: ${code}`;
    
    console.log(`[ADMIN] Бот завершился с кодом ${code}`);
    addActionLog('Завершение процесса', code === 0 ? 'info' : 'error', `Код выхода: ${code}`);
    notifyAdmins(exitMessage);
    botProcess = null;
  });
  
  // Уведомление об успешном запуске (с задержкой для инициализации)
  setTimeout(() => {
    if (botProcess && !botProcess.killed) {
      notifyAdmins(`✅ **Бот успешно запущен!**\n\nПроцесс активен и готов к работе.\nPID: ${botProcess.pid}`);
      addActionLog('Инициализация завершена', 'success', 'Бот готов к работе');
    }
  }, 3000);
  
  return true;
}

function stopBot(force = false) {
  const signal = force ? 'SIGKILL' : 'SIGINT';
  const stopType = force ? 'принудительная остановка (KILL)' : 'мягкая остановка (SIGINT)';
  console.log(`[ADMIN] ${stopType} бота...`);
  
  addActionLog('Остановка бота', 'info', `Инициирована ${stopType}`);
  notifyAdmins(`⏹️ **Остановка бота**\n\nИнициирована ${stopType} через админ-панель.`);
  
  let processToStop = null;
  let pidToStop = null;
  
  // Сначала пытаемся остановить отслеживаемый процесс
  if (botProcess && !botProcess.killed) {
    processToStop = botProcess;
    pidToStop = botProcess.pid;
  } else {
    // Если нет отслеживаемого процесса, ищем существующие
    const existingPid = findBotProcess();
    if (existingPid && isProcessAlive(existingPid)) {
      pidToStop = existingPid;
    }
  }
  
  if (!processToStop && !pidToStop) {
    console.log('[ADMIN] Процесс бота не найден для остановки');
    addActionLog('Остановка бота', 'error', 'Процесс не найден');
    notifyAdmins('⚠️ **Процесс не найден**\n\nБот уже остановлен или процесс не найден.');
    return false;
  }
  
  try {
    if (processToStop) {
      // Останавливаем отслеживаемый процесс
      processToStop.kill(signal);
      console.log(`[ADMIN] Отправлен сигнал ${signal} процессу ${processToStop.pid}`);
      addActionLog('Остановка бота', 'success', `Отправлен сигнал ${signal} процессу ${processToStop.pid}`);
    } else if (pidToStop) {
      // Останавливаем найденный процесс по PID
      process.kill(pidToStop, signal);
      console.log(`[ADMIN] Отправлен сигнал ${signal} процессу ${pidToStop}`);
      addActionLog('Остановка бота', 'success', `Отправлен сигнал ${signal} процессу ${pidToStop}`);
      
      // Для внешних процессов добавляем небольшую задержку для проверки завершения
      setTimeout(() => {
        if (!isProcessAlive(pidToStop)) {
          console.log(`[ADMIN] Процесс ${pidToStop} успешно завершен`);
          addActionLog('Процесс завершен', 'success', `PID: ${pidToStop}`);
        }
      }, 1000);
    }
    
    return true;
  } catch (e) {
    console.error('[ADMIN] Ошибка остановки процесса:', e);
    addActionLog('Остановка бота', 'error', `Ошибка: ${e.message}`);
    notifyAdmins(`❌ **Ошибка остановки бота**\n\nНе удалось остановить процесс: ${e.message}`);
    return false;
  }
}

// API endpoint для получения статуса бота в JSON
router.get('/api/status', (req, res) => {
  res.json({
    status: botStatus(),
    pid: getCurrentBotPid()
  });
});

// API endpoint для получения лога действий в JSON
router.get('/api/logs', (req, res) => {
  res.json({
    logs: getActionLogs(),
    count: getActionLogs().length
  });
});

// Clear action log
router.post('/clear-log', (req, res) => {
  actionLogs = [];
  addActionLog('Очистка лога', 'info', 'Лог действий очищен');
  res.redirect('/bot');
});

// Bot dashboard
router.get('/', (req, res) => {
  res.render('bot', {
    title: 'Управление Ботом',
    status: botStatus(),
    pid: getCurrentBotPid(),
    currentPage: 'status',
    actionLogs: getActionLogs()
  });
});

// Bot Settings page
router.get('/settings', (req, res) => {
  res.render('bot-settings', {
    title: 'Настройки Бота и OpenAI',
    currentToken: envManager.get('BOT_TOKEN', ''),
    openaiKey: envManager.get('OPENAI_API_KEY', ''),
    openaiBaseUrl: envManager.get('OPENAI_API_BASE_URL', 'https://api.llm7.io/v1'),
    openaiModel: envManager.get('OPENAI_MODEL', 'gpt-4.1-nano'),
    openaiMaxTokens: envManager.get('OPENAI_MAX_TOKENS', '200'),
    adminNotifications: envManager.get('ADMIN_NOTIFICATIONS', 'true') === 'true',
    currentPage: 'settings',
    envFileExists: envManager.exists(),
    envFilePath: envManager.getPath()
  });
});

router.post('/start', (req, res) => {
  addActionLog('Команда запуска', 'info', 'Запрос из веб-панели');
  startBot();
  res.redirect('/bot');
});

router.post('/stop', (req, res) => {
  addActionLog('Команда остановки', 'info', 'Запрос из веб-панели');
  stopBot(false);
  res.redirect('/bot');
});

router.post('/kill', (req, res) => {
  addActionLog('Команда убить процесс', 'info', 'Запрос из веб-панели');
  stopBot(true);
  res.redirect('/bot');
});

router.post('/restart', (req, res) => {
  addActionLog('Команда перезапуска', 'info', 'Запрос из веб-панели');
  // Если бот запущен, перезапускаем и перенаправляем ТОЛЬКО после старта нового процесса
  if (botProcess && !botProcess.killed) {
    console.log('[ADMIN] Перезапуск бота...');
    addActionLog('Перезапуск бота', 'info', 'Остановка текущего процесса...');
    notifyAdmins('🔄 **Перезапуск бота**\n\nИнициирован перезапуск через админ-панель. Остановка текущего процесса...');
    
    botProcess.once('exit', () => {
      // Запускаем новый процесс
      addActionLog('Перезапуск бота', 'info', 'Запуск нового процесса...');
      startBot();
      // Небольшая задержка, чтобы переменная botProcess успела обновиться
      setTimeout(() => res.redirect('/bot'), 100);
    });
    stopBot(false);
  } else {
    startBot();
    res.redirect('/bot');
  }
});

// Update bot token in .env
router.post('/update-token', (req, res) => {
  const newToken = (req.body.token || '').trim();
  if (!newToken) return res.redirect('/bot/settings');

  // Создаем .env файл если он не существует
  if (!envManager.exists()) {
    console.log('[ADMIN] Создаю .env файл...');
    if (!envManager.createDefault(newToken)) {
      console.error('[ADMIN] Ошибка создания .env файла');
      return res.status(500).json({ error: 'Ошибка создания .env файла' });
    }
  } else {
    // Обновляем существующий файл
    const result = envManager.set('BOT_TOKEN', newToken);
    if (!result) {
      console.error('[ADMIN] Ошибка обновления BOT_TOKEN');
      return res.status(500).json({ error: 'Ошибка обновления токена' });
    }
  }
  
  console.log('[ADMIN] BOT_TOKEN обновлен через envManager');
  res.redirect('/bot/settings?success=' + encodeURIComponent('Токен бота обновлен'));
});

// Update GPT settings
router.post('/gpt/update', (req, res) => {
  const { api_key, api_base_url, model, max_tokens } = req.body;
  
  const updates = {};
  if (api_key && api_key.trim()) updates['OPENAI_API_KEY'] = api_key.trim();
  if (api_base_url && api_base_url.trim()) updates['OPENAI_API_BASE_URL'] = api_base_url.trim();
  if (model && model.trim()) updates['OPENAI_MODEL'] = model.trim();
  if (max_tokens && String(max_tokens).trim()) updates['OPENAI_MAX_TOKENS'] = String(max_tokens).trim();

  if (Object.keys(updates).length > 0) {
    // Создаем .env файл если он не существует
    if (!envManager.exists()) {
      console.log('[ADMIN] Создаю .env файл для настроек OpenAI...');
      if (!envManager.createDefault()) {
        console.error('[ADMIN] Ошибка создания .env файла');
        return res.status(500).json({ error: 'Ошибка создания .env файла' });
      }
    }
    
    const results = envManager.setMultiple(updates);
    const successCount = Object.values(results).filter(r => r).length;
    console.log('[ADMIN] Настройки OpenAI обновлены через envManager:', results);
    
    if (successCount > 0) {
      return res.redirect('/bot/settings?success=' + encodeURIComponent(`Обновлено ${successCount} настроек OpenAI`));
    } else {
      return res.redirect('/bot/settings?error=' + encodeURIComponent('Ошибка обновления настроек OpenAI'));
    }
  }
  
  res.redirect('/bot/settings');
});

// Update notification settings
router.post('/notifications/update', (req, res) => {
  const { admin_notifications } = req.body;
  const notificationsEnabled = admin_notifications === 'on' ? 'true' : 'false';
  
  // Создаем .env файл если он не существует
  if (!envManager.exists()) {
    console.log('[ADMIN] Создаю .env файл для настроек уведомлений...');
    if (!envManager.createDefault()) {
      console.error('[ADMIN] Ошибка создания .env файла');
      return res.status(500).json({ error: 'Ошибка создания .env файла' });
    }
  }
  
  const result = envManager.set('ADMIN_NOTIFICATIONS', notificationsEnabled);
  
  if (result) {
    console.log(`[ADMIN] Уведомления ${notificationsEnabled === 'true' ? 'включены' : 'отключены'}`);
    
    // Отправляем тестовое уведомление если уведомления включены
    if (notificationsEnabled === 'true') {
      notifyAdmins('🔔 **Уведомления включены!**\n\nВы будете получать уведомления о запуске, остановке и перезапуске бота.');
    }
    
    return res.redirect('/bot/settings?success=' + encodeURIComponent('Настройки уведомлений обновлены'));
  } else {
    return res.redirect('/bot/settings?error=' + encodeURIComponent('Ошибка обновления настроек уведомлений'));
  }
});

// Stop admin panel itself
router.post('/panel/stop', (req, res) => {
  res.send('Панель выключается...');
  console.log('[ADMIN] Панель останавливается по запросу пользователя');
  setTimeout(() => process.exit(0), 500);
});

module.exports = router; 