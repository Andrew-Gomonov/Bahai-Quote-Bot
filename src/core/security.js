const { db } = require('./db');
const timeManager = require('./timeUtils');

class SecurityManager {
  constructor() {
    // Настройки безопасности
    this.MAX_LOGIN_ATTEMPTS = 5; // Максимум попыток входа
    this.LOCKOUT_TIME = 15 * 60 * 1000; // 15 минут блокировки
    this.SESSION_TIMEOUT = 8 * 60 * 60 * 1000; // 8 часов автовыход
    this.CLEANUP_INTERVAL = 60 * 60 * 1000; // Очистка каждый час
    
    // In-memory store для быстрого доступа
    this.attemptStore = new Map(); // username -> { attempts, lastAttempt, lockedUntil }
    this.ipStore = new Map(); // ip -> { attempts, lastAttempt, lockedUntil }
    
    // Запускаем периодическую очистку
    setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
    
    // Создаем таблицы при первом запуске
    this.initTables();
  }

  // Создание таблиц для логирования безопасности
  initTables() {
    db.serialize(() => {
      // Таблица попыток входа
      db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        ip_address TEXT,
        user_agent TEXT,
        success INTEGER NOT NULL DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        blocked INTEGER NOT NULL DEFAULT 0
      );`);
      
      // Таблица активных сессий
      db.run(`CREATE TABLE IF NOT EXISTS active_sessions (
        session_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      );`);
      
      // Добавляем поля в web_admins если их нет
      db.all('PRAGMA table_info(web_admins)', (err, columns) => {
        if (err) return;
        
        const hasLastLogin = columns.some(col => col.name === 'last_login_at');
        const hasLoginAttempts = columns.some(col => col.name === 'failed_attempts');
        const hasLockedUntil = columns.some(col => col.name === 'locked_until');
        const hasCreatedAt = columns.some(col => col.name === 'created_at');
        
        if (!hasLastLogin) {
          db.run('ALTER TABLE web_admins ADD COLUMN last_login_at DATETIME');
        }
        if (!hasLoginAttempts) {
          db.run('ALTER TABLE web_admins ADD COLUMN failed_attempts INTEGER DEFAULT 0');
        }
        if (!hasLockedUntil) {
          db.run('ALTER TABLE web_admins ADD COLUMN locked_until DATETIME');
        }
        if (!hasCreatedAt) {
          db.run('ALTER TABLE web_admins ADD COLUMN created_at DATETIME');
        }
      });
    });
  }

  // Проверка, заблокирован ли пользователь
  isUserLocked(username) {
    const userAttempts = this.attemptStore.get(username);
    if (!userAttempts) return false;
    
    const now = timeManager.now().toMillis();
    if (userAttempts.lockedUntil && now < userAttempts.lockedUntil) {
      return {
        locked: true,
        remainingTime: Math.ceil((userAttempts.lockedUntil - now) / 1000 / 60) // в минутах
      };
    }
    
    // Если время блокировки прошло, сбрасываем счетчик
    if (userAttempts.lockedUntil && now >= userAttempts.lockedUntil) {
      this.attemptStore.delete(username);
      this.resetUserAttempts(username);
    }
    
    return { locked: false };
  }

  // Проверка блокировки по IP
  isIpLocked(ip) {
    const ipAttempts = this.ipStore.get(ip);
    if (!ipAttempts) return false;
    
    const now = timeManager.now().toMillis();
    if (ipAttempts.lockedUntil && now < ipAttempts.lockedUntil) {
      return {
        locked: true,
        remainingTime: Math.ceil((ipAttempts.lockedUntil - now) / 1000 / 60)
      };
    }
    
    if (ipAttempts.lockedUntil && now >= ipAttempts.lockedUntil) {
      this.ipStore.delete(ip);
    }
    
    return { locked: false };
  }

  // Регистрация попытки входа
  recordLoginAttempt(username, ip, userAgent, success, blocked = false) {
    const now = timeManager.now().toMillis();
    
    // Записываем в БД с локальным временем
    const timestamp = timeManager.getSQLiteTimestamp();
    db.run(`INSERT INTO login_attempts (username, ip_address, user_agent, success, blocked, timestamp) 
            VALUES (?, ?, ?, ?, ?, ?)`, [username, ip, userAgent, success ? 1 : 0, blocked ? 1 : 0, timestamp]);
    
    if (success) {
      // Успешный вход - сбрасываем счетчики
      this.attemptStore.delete(username);
      this.ipStore.delete(ip);
      this.resetUserAttempts(username);
      
      // Обновляем время последнего входа в локальном времени
      const localTimestamp = timeManager.getSQLiteTimestamp();
      db.run('UPDATE web_admins SET last_login_at = ?, failed_attempts = 0, locked_until = NULL WHERE username = ?', [localTimestamp, username]);
    } else {
      // Неудачная попытка - увеличиваем счетчики
      this.incrementAttempts(username, ip, now);
    }
  }

  // Увеличение счетчика попыток
  incrementAttempts(username, ip, now) {
    // Обновляем счетчик для пользователя
    let userAttempts = this.attemptStore.get(username) || { attempts: 0, lastAttempt: 0, lockedUntil: null };
    userAttempts.attempts++;
    userAttempts.lastAttempt = now;
    
    if (userAttempts.attempts >= this.MAX_LOGIN_ATTEMPTS) {
      userAttempts.lockedUntil = now + this.LOCKOUT_TIME;
    }
    
    this.attemptStore.set(username, userAttempts);
    
    // Обновляем счетчик для IP
    let ipAttempts = this.ipStore.get(ip) || { attempts: 0, lastAttempt: 0, lockedUntil: null };
    ipAttempts.attempts++;
    ipAttempts.lastAttempt = now;
    
    if (ipAttempts.attempts >= this.MAX_LOGIN_ATTEMPTS * 2) { // IP блокируется при двойном лимите
      ipAttempts.lockedUntil = now + this.LOCKOUT_TIME;
    }
    
    this.ipStore.set(ip, ipAttempts);
    
    // Обновляем БД
    const lockoutTimeISO = userAttempts.lockedUntil ? timeManager.fromUTC(new Date(userAttempts.lockedUntil).toISOString()).toISO() : null;
    db.run('UPDATE web_admins SET failed_attempts = failed_attempts + 1, locked_until = ? WHERE username = ?', 
      [lockoutTimeISO, username]);
  }

  // Сброс попыток для пользователя
  resetUserAttempts(username) {
    db.run('UPDATE web_admins SET failed_attempts = 0, locked_until = NULL WHERE username = ?', [username]);
  }

  // Создание активной сессии
  createSession(sessionId, username, ip, userAgent) {
    const expiresAt = timeManager.addTime(null, this.SESSION_TIMEOUT / (60 * 1000), 'minutes').toISO();
    const createdAt = timeManager.getSQLiteTimestamp();
    
    db.run(`INSERT OR REPLACE INTO active_sessions 
            (session_id, username, ip_address, user_agent, created_at, last_activity, expires_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`, 
           [sessionId, username, ip, userAgent, createdAt, createdAt, expiresAt]);
  }

  // Обновление активности сессии
  updateSessionActivity(sessionId) {
    const expiresAt = timeManager.addTime(null, this.SESSION_TIMEOUT / (60 * 1000), 'minutes').toISO();
    const lastActivity = timeManager.getSQLiteTimestamp();
    
    db.run(`UPDATE active_sessions 
            SET last_activity = ?, expires_at = ? 
            WHERE session_id = ?`, [lastActivity, expiresAt, sessionId]);
  }

  // Проверка валидности сессии
  isSessionValid(sessionId, callback) {
    db.get(`SELECT * FROM active_sessions 
            WHERE session_id = ? AND expires_at > CURRENT_TIMESTAMP`, 
           [sessionId], (err, row) => {
      if (err) return callback(err, false);
      callback(null, !!row, row ? row.username : null);
    });
  }

  // Удаление сессии
  destroySession(sessionId) {
    db.run('DELETE FROM active_sessions WHERE session_id = ?', [sessionId]);
  }

  // Получение статистики безопасности
  getSecurityStats(callback) {
    const stats = {};
    
    // Статистика за последние 24 часа
    db.get(`SELECT 
              COUNT(*) as total_attempts,
              SUM(success) as successful_logins,
              COUNT(*) - SUM(success) as failed_attempts
            FROM login_attempts 
            WHERE timestamp > datetime('now', '-1 day')`, (err, row) => {
      if (err) return callback(err);
      stats.last24h = row;
      
      // Активные сессии
      db.get(`SELECT COUNT(*) as active_sessions 
              FROM active_sessions 
              WHERE expires_at > CURRENT_TIMESTAMP`, (err2, row2) => {
        if (err2) return callback(err2);
        stats.activeSessions = row2.active_sessions;
        
        // Заблокированные пользователи
        db.get(`SELECT COUNT(*) as locked_users 
                FROM web_admins 
                WHERE locked_until > CURRENT_TIMESTAMP`, (err3, row3) => {
          if (err3) return callback(err3);
          stats.lockedUsers = row3.locked_users;
          
          // Последние попытки входа
          db.all(`SELECT username, ip_address, success, timestamp, blocked
                  FROM login_attempts 
                  ORDER BY timestamp DESC 
                  LIMIT 10`, (err4, rows) => {
            if (err4) return callback(err4);
            stats.recentAttempts = rows;
            callback(null, stats);
          });
        });
      });
    });
  }

  // Очистка устаревших записей
  cleanup() {
    const now = timeManager.now().toMillis();
    
    // Очищаем memory stores
    for (const [key, value] of this.attemptStore.entries()) {
      if (value.lockedUntil && now >= value.lockedUntil) {
        this.attemptStore.delete(key);
      }
    }
    
    for (const [key, value] of this.ipStore.entries()) {
      if (value.lockedUntil && now >= value.lockedUntil) {
        this.ipStore.delete(key);
      }
    }
    
    // Очищаем БД - используем локальное время
    const thirtyDaysAgo = timeManager.addTime(null, -30, 'days').toISO();
    const currentTime = timeManager.getSQLiteTimestamp();
    
    db.run(`DELETE FROM login_attempts 
            WHERE timestamp < ?`, [thirtyDaysAgo]); // Храним логи 30 дней
            
    db.run(`DELETE FROM active_sessions 
            WHERE expires_at < ?`, [currentTime]); // Удаляем просроченные сессии
            
    db.run(`UPDATE web_admins 
            SET locked_until = NULL 
            WHERE locked_until < ?`, [currentTime]); // Снимаем блокировки
    
    return 0; // Silent cleanup - no console output
  }

  // Разблокировка пользователя админом
  unlockUser(username) {
    this.attemptStore.delete(username);
    this.resetUserAttempts(username);
  }

  // Принудительный выход всех сессий пользователя
  logoutAllSessions(username) {
    db.run('DELETE FROM active_sessions WHERE username = ?', [username]);
  }
}

// Создаем единственный экземпляр
const securityManager = new SecurityManager();

module.exports = securityManager;