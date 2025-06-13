// Утилиты для работы с временными зонами
const { DateTime } = require('luxon');

class TimeManager {
  constructor() {
    this.timezone = process.env.TZ || 'Europe/Chisinau';
    console.log(`[TIME] Используется часовой пояс: ${this.timezone}`);
  }

  // Определение системной временной зоны
  detectSystemTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (error) {
      console.warn('[TIME] Could not detect system timezone, using Europe/Chisinau');
      return 'Europe/Chisinau'; // Fallback для Молдовы
    }
  }

  // Получение текущего времени в локальной временной зоне
  now() {
    return DateTime.now().setZone(this.timezone);
  }

  // Преобразование UTC времени в локальное
  fromUTC(utcString) {
    if (!utcString) return null;
    
    try {
      // Если это уже DateTime объект
      if (utcString instanceof DateTime) {
        return utcString.setZone(this.timezone);
      }
      
      // Преобразуем в строку для обработки
      const timeStr = utcString.toString();
      
      // Попробуем разные форматы
      let dt;
      
      // Формат SQLite: "YYYY-MM-DD HH:mm:ss"
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timeStr)) {
        dt = DateTime.fromSQL(timeStr, { zone: 'utc' });
      } 
      // ISO формат
      else {
        dt = DateTime.fromISO(timeStr, { zone: 'utc' });
      }
      
      if (!dt.isValid) {
        console.error('[TIME] Invalid DateTime:', timeStr, dt.invalidReason);
        return null;
      }
      
      return dt.setZone(this.timezone);
    } catch (error) {
      console.error('[TIME] Error converting UTC time:', error);
      return null;
    }
  }

  // Преобразование локального времени в UTC для сохранения в БД
  toUTC(localTime) {
    if (!localTime) return null;
    
    try {
      if (localTime instanceof DateTime) {
        return localTime.toUTC();
      }
      
      const dt = DateTime.fromISO(localTime.toString()).setZone(this.timezone);
      return dt.toUTC();
    } catch (error) {
      console.error('[TIME] Error converting to UTC:', error);
      return DateTime.now().toUTC();
    }
  }

  // Форматирование времени для отображения пользователю
  formatForDisplay(utcTime, format = 'dd.MM.yyyy HH:mm:ss') {
    if (!utcTime) return 'Никогда';
    
    try {
      const localTime = this.fromUTC(utcTime);
      if (!localTime) return 'Ошибка времени';
      
      return localTime.toFormat(format);
    } catch (error) {
      console.error('[TIME] Error formatting time:', error);
      return 'Ошибка времени';
    }
  }

  // Форматирование времени в стиле toLocaleString
  formatLocaleString(utcTime, locale = 'ru-RU', options = {}) {
    if (!utcTime) return 'Никогда';
    
    try {
      const localTime = this.fromUTC(utcTime);
      if (!localTime) return 'Ошибка времени';
      
      const defaultOptions = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: this.timezone
      };
      
      return localTime.toLocaleString(locale, { ...defaultOptions, ...options });
    } catch (error) {
      console.error('[TIME] Error formatting locale string:', error);
      return 'Ошибка времени';
    }
  }

  // Относительное время (например, "5 минут назад")
  formatRelative(utcTime) {
    if (!utcTime) return 'Никогда';
    
    try {
      const localTime = this.fromUTC(utcTime);
      if (!localTime) return 'Ошибка времени';
      
      const now = this.now();
      const diff = now.diff(localTime, ['days', 'hours', 'minutes', 'seconds']);
      
      if (diff.days > 0) {
        return `${Math.floor(diff.days)} дн. назад`;
      } else if (diff.hours > 0) {
        return `${Math.floor(diff.hours)} ч. назад`;
      } else if (diff.minutes > 0) {
        return `${Math.floor(diff.minutes)} мин. назад`;
      } else {
        return 'Только что';
      }
    } catch (error) {
      console.error('[TIME] Error formatting relative time:', error);
      return 'Ошибка времени';
    }
  }

  // Проверка, истекло ли время (для блокировок)
  isExpired(utcTime) {
    if (!utcTime) return true;
    
    try {
      const targetTime = this.fromUTC(utcTime);
      const now = this.now();
      return now > targetTime;
    } catch (error) {
      console.error('[TIME] Error checking expiration:', error);
      return true;
    }
  }

  // Добавление времени (для создания времени блокировки)
  addTime(baseTime, amount, unit = 'minutes') {
    try {
      let dt;
      if (baseTime) {
        dt = this.fromUTC(baseTime);
      } else {
        dt = this.now();
      }
      
      return dt.plus({ [unit]: amount }).toUTC();
    } catch (error) {
      console.error('[TIME] Error adding time:', error);
      return this.now().toUTC();
    }
  }

  // Получение времени для SQLite (в UTC)
  getSQLiteTimestamp() {
    return this.now().toUTC().toISO();
  }

  // Получение времени блокировки (текущее время + offset в минутах)
  getLockoutTime(offsetMinutes = 15) {
    return this.addTime(null, offsetMinutes, 'minutes').toISO();
  }

  // Получение оставшегося времени блокировки в минутах
  getRemainingLockoutTime(lockoutTimeUTC) {
    if (!lockoutTimeUTC) return 0;
    
    try {
      const lockoutTime = this.fromUTC(lockoutTimeUTC);
      const now = this.now();
      const diff = lockoutTime.diff(now, 'minutes');
      
      return Math.max(0, Math.ceil(diff.minutes));
    } catch (error) {
      console.error('[TIME] Error calculating remaining time:', error);
      return 0;
    }
  }

  // Информация о временной зоне
  getTimezoneInfo() {
    const now = this.now();
    return {
      timezone: this.timezone,
      offset: now.toFormat('ZZ'),
      offsetName: now.toFormat('ZZZZ'),
      localTime: now.toFormat('dd.MM.yyyy HH:mm:ss'),
      utcTime: now.toUTC().toFormat('dd.MM.yyyy HH:mm:ss')
    };
  }
}

// Создаем единственный экземпляр
const timeManager = new TimeManager();

module.exports = timeManager; 