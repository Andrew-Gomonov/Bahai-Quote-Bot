const express = require('express');
const { db } = require('../../core/db');
const { LEVELS, ACHIEVEMENTS } = require('../../bot/stats');
const { DateTime } = require('luxon');

const router = express.Router();

// Страница общей статистики
router.get('/', (req, res) => {
  const stats = {};
  
  // Общие метрики
  db.get('SELECT COUNT(*) as total FROM users', (err, userCount) => {
    if (err) return res.status(500).send(err.message);
    stats.totalUsers = userCount.total;
    
    db.get('SELECT COUNT(*) as total FROM quotes', (err2, quoteCount) => {
      if (err2) return res.status(500).send(err2.message);
      stats.totalQuotes = quoteCount.total;
      
      db.get('SELECT COUNT(*) as total FROM quote_reads', (err3, readCount) => {
        if (err3) return res.status(500).send(err3.message);
        stats.totalReads = readCount.total;
        
        db.get('SELECT COUNT(*) as total FROM favorite_quotes', (err3_5, favoriteCount) => {
          if (err3_5) return res.status(500).send(err3_5.message);
          stats.totalFavorites = favoriteCount.total;
          
          // Активные пользователи (читали цитаты за последние 30 дней)
          const thirtyDaysAgo = DateTime.now().minus({ days: 30 }).toISODate();
          db.get(
            'SELECT COUNT(DISTINCT chat_id) as active FROM quote_reads WHERE read_at >= ?',
            [thirtyDaysAgo],
            (err4, activeCount) => {
              if (err4) return res.status(500).send(err4.message);
              stats.activeUsers = activeCount.active;
              
              // Топ пользователей по цитатам
              db.all(
                `SELECT 
                  chat_id,
                  quotes_read_total,
                  daily_streak,
                  level,
                  experience,
                  joined_at
                FROM users 
                WHERE quotes_read_total > 0
                ORDER BY quotes_read_total DESC 
                LIMIT 10`,
                (err5, topUsers) => {
                  if (err5) return res.status(500).send(err5.message);
                  stats.topUsers = topUsers || [];
                  
                  // Статистика по уровням
                  db.all(
                    'SELECT level, COUNT(*) as count FROM users GROUP BY level ORDER BY level',
                    (err6, levelStats) => {
                      if (err6) return res.status(500).send(err6.message);
                      stats.levelDistribution = levelStats || [];
                      
                      // Статистика достижений
                      db.all(
                        'SELECT achievement_type, COUNT(*) as count FROM user_achievements GROUP BY achievement_type ORDER BY count DESC',
                        (err7, achievementStats) => {
                          if (err7) return res.status(500).send(err7.message);
                          stats.achievements = achievementStats || [];
                          
                          // Статистика чтения по дням (последние 30 дней)
                          db.all(
                            `SELECT 
                              DATE(read_at) as date,
                              COUNT(*) as reads,
                              COUNT(DISTINCT chat_id) as unique_readers
                            FROM quote_reads 
                            WHERE read_at >= ?
                            GROUP BY DATE(read_at)
                            ORDER BY date DESC`,
                            [thirtyDaysAgo],
                            (err8, dailyStats) => {
                              if (err8) return res.status(500).send(err8.message);
                              stats.dailyReads = dailyStats || [];
                              
                              res.render('admin_stats', {
                                title: 'Статистика и аналитика',
                                stats,
                                LEVELS,
                                ACHIEVEMENTS
                              });
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
      });
    });
  });
});

// API для получения данных графиков
router.get('/api/charts', (req, res) => {
  const thirtyDaysAgo = DateTime.now().minus({ days: 30 }).toISODate();
  
  // Статистика по дням
  db.all(
    `SELECT 
      DATE(read_at) as date,
      COUNT(*) as reads,
      COUNT(DISTINCT chat_id) as users
    FROM quote_reads 
    WHERE read_at >= ?
    GROUP BY DATE(read_at)
    ORDER BY date ASC`,
    [thirtyDaysAgo],
    (err, dailyData) => {
      if (err) return res.status(500).json({ error: err.message });
      
      // Распределение по уровням
      db.all(
        'SELECT level, COUNT(*) as count FROM users GROUP BY level ORDER BY level',
        (err2, levelData) => {
          if (err2) return res.status(500).json({ error: err2.message });
          
          // Популярные достижения
          db.all(
            'SELECT achievement_type, COUNT(*) as count FROM user_achievements GROUP BY achievement_type ORDER BY count DESC LIMIT 10',
            (err3, achievementData) => {
              if (err3) return res.status(500).json({ error: err3.message });
              
              res.json({
                daily: dailyData || [],
                levels: levelData || [],
                achievements: achievementData || []
              });
            }
          );
        }
      );
    }
  );
});

// Детальная статистика пользователя
router.get('/user/:chatId', (req, res) => {
  const chatId = req.params.chatId;
  
  db.get(
    `SELECT 
      chat_id,
      timezone,
      daily_time,
      daily_enabled,
      broadcast_enabled,
      quotes_read_total,
      daily_streak,
      level,
      experience,
      joined_at,
      last_active_at,
      last_daily_sent
    FROM users WHERE chat_id = ?`,
    [chatId],
    (err, user) => {
      if (err) return res.status(500).send(err.message);
      if (!user) return res.status(404).send('Пользователь не найден');
      
      // Получаем достижения пользователя
      db.all(
        'SELECT * FROM user_achievements WHERE chat_id = ? ORDER BY achieved_at DESC',
        [chatId],
        (err2, achievements) => {
          if (err2) return res.status(500).send(err2.message);
          
          // Получаем историю чтения
          db.all(
            `SELECT qr.*, q.text 
            FROM quote_reads qr 
            LEFT JOIN quotes q ON qr.quote_id = q.id 
            WHERE qr.chat_id = ? 
            ORDER BY qr.read_at DESC 
            LIMIT 50`,
            [chatId],
            (err3, readHistory) => {
              if (err3) return res.status(500).send(err3.message);
              
              // Получаем избранные цитаты пользователя
              db.all(
                `SELECT f.*, q.text 
                FROM favorite_quotes f 
                LEFT JOIN quotes q ON f.quote_id = q.id 
                WHERE f.chat_id = ? 
                ORDER BY f.favorited_at DESC 
                LIMIT 20`,
                [chatId],
                (err4, favoriteQuotes) => {
                  if (err4) return res.status(500).send(err4.message);
                  
                  res.render('user_stats', {
                    title: `Статистика пользователя ${chatId}`,
                    user,
                    achievements: achievements || [],
                    readHistory: readHistory || [],
                    favoriteQuotes: favoriteQuotes || [],
                    LEVELS,
                    ACHIEVEMENTS
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

module.exports = router; 