const { DateTime } = require('luxon');
const { db } = require('../core/db');

// Константы для системы уровней
const LEVELS = {
  1: { name: 'Начинающий', exp: 0, quotes: 0 },
  2: { name: 'Ищущий', exp: 50, quotes: 10 },
  3: { name: 'Ученик', exp: 150, quotes: 30 },
  4: { name: 'Мудрец', exp: 300, quotes: 75 },
  5: { name: 'Учитель', exp: 500, quotes: 150 },
  6: { name: 'Просветленный', exp: 800, quotes: 300 },
  7: { name: 'Мастер', exp: 1200, quotes: 500 },
};

// Типы достижений
const ACHIEVEMENTS = {
  FIRST_QUOTE: { name: 'Первая цитата', description: 'Прочитана первая цитата', exp: 10 },
  FIRST_FAVORITE: { name: 'Первое избранное', description: 'Добавлена первая избранная цитата', exp: 15 },
  DAILY_STREAK_3: { name: 'Постоянство', description: '3 дня подряд читает цитаты', exp: 25 },
  DAILY_STREAK_7: { name: 'Неделя мудрости', description: '7 дней подряд читает цитаты', exp: 50 },
  DAILY_STREAK_30: { name: 'Месяц вдохновения', description: '30 дней подряд читает цитаты', exp: 150 },
  QUOTES_10: { name: 'Любознательный', description: 'Прочитано 10 цитат', exp: 20 },
  QUOTES_50: { name: 'Книголюб', description: 'Прочитано 50 цитат', exp: 75 },
  QUOTES_100: { name: 'Мудрец', description: 'Прочитано 100 цитат', exp: 150 },
  QUOTES_250: { name: 'Знаток', description: 'Прочитано 250 цитат', exp: 300 },
  QUOTES_500: { name: 'Эрудит', description: 'Прочитано 500 цитат', exp: 500 },
  WITH_BOT_7: { name: 'Неделя с ботом', description: '7 дней с момента регистрации', exp: 30 },
  WITH_BOT_30: { name: 'Месяц с ботом', description: '30 дней с момента регистрации', exp: 100 },
  WITH_BOT_365: { name: 'Год мудрости', description: '365 дней с момента регистрации', exp: 365 },
};

// Записываем прочтение цитаты
function recordQuoteRead(chatId, quoteId, readType = 'manual') {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    
    // Записываем факт прочтения
    db.run(
      'INSERT INTO quote_reads (chat_id, quote_id, read_at, read_type) VALUES (?, ?, ?, ?)',
      [chatId, quoteId, now, readType],
      function(err) {
        if (err) return reject(err);
        
        // Обновляем счетчик и последнюю активность
        db.run(
          'UPDATE users SET quotes_read_total = quotes_read_total + 1, last_active_at = ? WHERE chat_id = ?',
          [now, chatId],
          (err2) => {
            if (err2) return reject(err2);
            
            // Проверяем достижения и обновляем уровень
            checkAndAwardAchievements(chatId)
              .then(() => updateUserLevel(chatId))
              .then(() => resolve())
              .catch(reject);
          }
        );
      }
    );
  });
}

// Обновляем ежедневный стрик
function updateDailyStreak(chatId) {
  return new Promise((resolve, reject) => {
    const today = DateTime.now().toISODate();
    const yesterday = DateTime.now().minus({ days: 1 }).toISODate();
    
    db.get(
      'SELECT daily_streak, last_daily_sent FROM users WHERE chat_id = ?',
      [chatId],
      (err, user) => {
        if (err) return reject(err);
        if (!user) return resolve();
        
        let newStreak = 1;
        
        if (user.last_daily_sent === yesterday) {
          // Продолжаем стрик
          newStreak = (user.daily_streak || 0) + 1;
        } else if (user.last_daily_sent !== today) {
          // Прерываем стрик (если не сегодня)
          newStreak = 1;
        } else {
          // Уже получал сегодня
          newStreak = user.daily_streak || 1;
        }
        
        db.run(
          'UPDATE users SET daily_streak = ? WHERE chat_id = ?',
          [newStreak, chatId],
          (err2) => {
            if (err2) return reject(err2);
            
            // Проверяем достижения за стрики
            checkStreakAchievements(chatId, newStreak)
              .then(() => resolve(newStreak))
              .catch(reject);
          }
        );
      }
    );
  });
}

// Получение статистики пользователя
function getUserStats(chatId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 
        quotes_read_total,
        daily_streak,
        level,
        experience,
        joined_at,
        last_active_at
      FROM users WHERE chat_id = ?`,
      [chatId],
      (err, user) => {
        if (err) return reject(err);
        if (!user) return resolve(null);
        
        // Получаем достижения
        db.all(
          'SELECT achievement_type, achievement_name, achieved_at FROM user_achievements WHERE chat_id = ? ORDER BY achieved_at DESC',
          [chatId],
          (err2, achievements) => {
            if (err2) return reject(err2);
            
            // Вычисляем дни с ботом
            const joinedDate = DateTime.fromISO(user.joined_at);
            const daysWithBot = Math.floor(DateTime.now().diff(joinedDate, 'days').days);
            
            // Информация о текущем и следующем уровне
            const currentLevel = LEVELS[user.level] || LEVELS[1];
            const nextLevel = LEVELS[user.level + 1];
            
            resolve({
              quotesRead: user.quotes_read_total || 0,
              dailyStreak: user.daily_streak || 0,
              level: user.level || 1,
              levelName: currentLevel.name,
              experience: user.experience || 0,
              daysWithBot: Math.max(0, daysWithBot),
              achievements: achievements || [],
              nextLevel: nextLevel ? {
                level: user.level + 1,
                name: nextLevel.name,
                expNeeded: nextLevel.exp - (user.experience || 0)
              } : null
            });
          }
        );
      }
    );
  });
}

// Проверка и выдача достижений
function checkAndAwardAchievements(chatId) {
  return new Promise((resolve, reject) => {
    getUserStats(chatId).then(stats => {
      if (!stats) return resolve();
      
      const achievementsToAward = [];
      
      // Достижения за количество цитат
      if (stats.quotesRead === 1) achievementsToAward.push('FIRST_QUOTE');
      if (stats.quotesRead === 10) achievementsToAward.push('QUOTES_10');
      if (stats.quotesRead === 50) achievementsToAward.push('QUOTES_50');
      if (stats.quotesRead === 100) achievementsToAward.push('QUOTES_100');
      if (stats.quotesRead === 250) achievementsToAward.push('QUOTES_250');
      if (stats.quotesRead === 500) achievementsToAward.push('QUOTES_500');
      
      // Достижения за время с ботом
      if (stats.daysWithBot === 7) achievementsToAward.push('WITH_BOT_7');
      if (stats.daysWithBot === 30) achievementsToAward.push('WITH_BOT_30');
      if (stats.daysWithBot === 365) achievementsToAward.push('WITH_BOT_365');
      
      awardAchievements(chatId, achievementsToAward).then(resolve).catch(reject);
    }).catch(reject);
  });
}

// Проверка достижений за стрики
function checkStreakAchievements(chatId, streak) {
  return new Promise((resolve, reject) => {
    const achievementsToAward = [];
    
    if (streak === 3) achievementsToAward.push('DAILY_STREAK_3');
    if (streak === 7) achievementsToAward.push('DAILY_STREAK_7');
    if (streak === 30) achievementsToAward.push('DAILY_STREAK_30');
    
    awardAchievements(chatId, achievementsToAward).then(resolve).catch(reject);
  });
}

// Выдача достижений
function awardAchievements(chatId, achievementTypes) {
  return new Promise((resolve, reject) => {
    if (!achievementTypes.length) return resolve([]);
    
    const awarded = [];
    let completed = 0;
    
    achievementTypes.forEach(type => {
      // Проверяем, есть ли уже это достижение
      db.get(
        'SELECT 1 FROM user_achievements WHERE chat_id = ? AND achievement_type = ?',
        [chatId, type],
        (err, existing) => {
          if (err) return reject(err);
          
          if (!existing && ACHIEVEMENTS[type]) {
            const achievement = ACHIEVEMENTS[type];
            const now = new Date().toISOString();
            
            // Добавляем достижение
            db.run(
              'INSERT INTO user_achievements (chat_id, achievement_type, achievement_name, achieved_at) VALUES (?, ?, ?, ?)',
              [chatId, type, achievement.name, now],
              (err2) => {
                if (err2) return reject(err2);
                
                // Добавляем опыт
                db.run(
                  'UPDATE users SET experience = experience + ? WHERE chat_id = ?',
                  [achievement.exp, chatId],
                  (err3) => {
                    if (err3) return reject(err3);
                    
                    awarded.push({
                      type,
                      name: achievement.name,
                      description: achievement.description,
                      exp: achievement.exp
                    });
                    
                    completed++;
                    if (completed === achievementTypes.length) {
                      resolve(awarded);
                    }
                  }
                );
              }
            );
          } else {
            completed++;
            if (completed === achievementTypes.length) {
              resolve(awarded);
            }
          }
        }
      );
    });
  });
}

// Обновление уровня пользователя
function updateUserLevel(chatId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT experience, level FROM users WHERE chat_id = ?',
      [chatId],
      (err, user) => {
        if (err) return reject(err);
        if (!user) return resolve();
        
        const currentExp = user.experience || 0;
        let newLevel = user.level || 1;
        
        // Находим подходящий уровень
        for (let level = 7; level >= 1; level--) {
          if (currentExp >= LEVELS[level].exp) {
            newLevel = level;
            break;
          }
        }
        
        if (newLevel !== user.level) {
          db.run(
            'UPDATE users SET level = ? WHERE chat_id = ?',
            [newLevel, chatId],
            (err2) => {
              if (err2) return reject(err2);
              resolve(newLevel);
            }
          );
        } else {
          resolve(user.level);
        }
      }
    );
  });
}

// Форматирование статистики для отображения
function formatUserStats(stats) {
  if (!stats) return 'Статистика недоступна.';
  
  const progressBar = (current, max, length = 10) => {
    const filled = Math.floor((current / max) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  };
  
  let text = `📊 **Ваша статистика**\n\n`;
  
  // Основные показатели
  text += `📚 **Прочитано цитат:** ${stats.quotesRead}\n`;
  text += `🔥 **Ежедневный стрик:** ${stats.dailyStreak} дн.\n`;
  text += `📅 **Дней с ботом:** ${stats.daysWithBot}\n\n`;
  
  // Уровень и опыт
  text += `🎖️ **Уровень:** ${stats.level} (${stats.levelName})\n`;
  text += `⭐ **Опыт:** ${stats.experience}\n`;
  
  if (stats.nextLevel) {
    const nextLevelExp = LEVELS[stats.nextLevel.level].exp;
    const progress = progressBar(stats.experience, nextLevelExp);
    text += `${progress} до ${stats.nextLevel.name}\n`;
    text += `(осталось ${stats.nextLevel.expNeeded} опыта)\n\n`;
  } else {
    text += `🏆 **Максимальный уровень достигнут!**\n\n`;
  }
  
  // Последние достижения
  if (stats.achievements.length > 0) {
    text += `🏅 **Последние достижения:**\n`;
    stats.achievements.slice(0, 3).forEach(ach => {
      const date = DateTime.fromISO(ach.achieved_at).toFormat('dd.MM.yyyy');
      text += `• ${ach.achievement_name} (${date})\n`;
    });
    
    if (stats.achievements.length > 3) {
      text += `• ... и ещё ${stats.achievements.length - 3}\n`;
    }
  } else {
    text += `🏅 **Достижений пока нет**\nЧитайте цитаты каждый день, чтобы получить первое достижение!`;
  }
  
  return text;
}

// Получение топа пользователей
function getLeaderboard(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
        chat_id,
        quotes_read_total,
        daily_streak,
        level,
        experience
      FROM users 
      WHERE quotes_read_total > 0
      ORDER BY experience DESC, quotes_read_total DESC 
      LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}

// Проверка достижений за избранные цитаты
function checkFavoriteAchievements(chatId) {
  return new Promise((resolve, reject) => {
    const { getFavoriteCount } = require('./favorites');
    
    getFavoriteCount(chatId).then(count => {
      const achievementsToAward = [];
      
      if (count === 1) achievementsToAward.push('FIRST_FAVORITE');
      
      awardAchievements(chatId, achievementsToAward).then(resolve).catch(reject);
    }).catch(reject);
  });
}

module.exports = {
  recordQuoteRead,
  updateDailyStreak,
  getUserStats,
  formatUserStats,
  getLeaderboard,
  checkFavoriteAchievements,
  LEVELS,
  ACHIEVEMENTS
}; 