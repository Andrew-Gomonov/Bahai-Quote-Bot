const { DateTime } = require('luxon');
const { DEFAULT_TZ, DEFAULT_DAILY_TIME } = require('../core/db'); // ИЗМЕНЕНО
const {
  getRandomQuote,
  getQuoteById,
  sendQuote,
  searchQuotes,
  formatQuote,
  getQuotesCount,
} = require('./quotes'); // ИЗМЕНЕНО (пока так, потом quotes.js тоже переедет)
const {
  recordQuoteRead,
  updateDailyStreak,
  getUserStats,
  formatUserStats,
  getLeaderboard,
  checkFavoriteAchievements,
  LEVELS
} = require('./stats');
const {
  addToFavorites,
  removeFromFavorites,
  isFavorite,
  getFavoriteQuotes,
  getFavoriteCount,
  getRandomFavorite
} = require('./favorites');
const {
  advancedSearch,
  searchByAuthor,
  searchByTheme,
  getAllAuthors,
  getAllThemes,
  formatSearchResult,
  getSearchStats
} = require('./search');
const {
  generateQuoteExplanation,
  formatExplanation,
  isExplanationsEnabled
} = require('./aiExplainer');

function registerCommands(bot, db, broadcastToAll, tgError) {
  // helper
  function isValidTime(str) {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(str);
  }

  function isAdmin(chatId, cb) {
    db.get('SELECT 1 FROM admins WHERE chat_id = ?', [chatId], (err, row) => {
      if (err) return cb(err, false);
      cb(null, !!row);
    });
  }

  // Функция для уведомления о новых достижениях
  function notifyAchievements(chatId, achievements) {
    if (achievements && achievements.length > 0) {
      achievements.forEach(ach => {
        const message = `🏅 **Новое достижение!**\n\n**${ach.name}**\n${ach.description}\n\n+${ach.exp} опыта ⭐`;
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' }).catch(tgError);
      });
    }
  }

  // ---------------- USER COMMANDS ----------------
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    db.get('SELECT daily_enabled, broadcast_enabled, joined_at FROM users WHERE chat_id = ?', [chatId], (err, row) => {
      if (err) return console.error(err);

      if (row && row.daily_enabled === 1 && row.broadcast_enabled === 1) {
        bot.sendMessage(chatId, 'Вы уже подписаны.').catch(tgError);
        return;
      }

      const now = new Date().toISOString();
      // либо не было записи, либо была, но выключена частично/полностью
      db.run(
        `INSERT INTO users (chat_id, timezone, daily_time, daily_enabled, broadcast_enabled, joined_at)
         VALUES (?, ?, ?, 1, 1, ?)
         ON CONFLICT(chat_id) DO UPDATE SET daily_enabled = 1, broadcast_enabled = 1, joined_at = COALESCE(joined_at, ?)`,
        [chatId, DEFAULT_TZ, DEFAULT_DAILY_TIME, now, now],
        (err2) => {
          if (err2) return console.error(err2);
          const welcomeText = `🕊️ **Добро пожаловать в Bahai Quote Bot!**

🌟 *Ваше духовное путешествие начинается здесь*

Вы успешно подписались на ежедневные цитаты мудрости Бахаи!

📅 **Ваши настройки:**
⏰ Время доставки: ${DEFAULT_DAILY_TIME}
🌍 Часовой пояс: ${DEFAULT_TZ}
🔔 Уведомления: включены

🎯 **Что дальше?**
• Получите первую цитату: /quote
• Изучите все возможности: /help
• Настройте под себя: /time, /tz

🌟 *Пусть каждый день приносит новую мудрость!*`;

          const welcomeKeyboard = {
            inline_keyboard: [
              [
                { text: '🎲 Получить цитату', callback_data: 'more' },
                { text: '❓ Справка', callback_data: 'help_main' }
              ],
              [
                { text: '⚙️ Настройки', callback_data: 'help_settings' },
                { text: '📊 Моя статистика', callback_data: 'quick_stats' }
              ]
            ]
          };

          bot.sendMessage(chatId, welcomeText, { 
            parse_mode: 'Markdown',
            reply_markup: welcomeKeyboard 
          }).catch(tgError);
        }
      );
    });
  });

  bot.onText(/\/stop/, (msg) => {
    const chatId = msg.chat.id;

    db.get('SELECT daily_enabled, broadcast_enabled FROM users WHERE chat_id = ?', [chatId], (err, row) => {
      if (err) return console.error(err);

      if (!row || (row.daily_enabled === 0 && row.broadcast_enabled === 0)) {
        bot.sendMessage(chatId, 'Вы уже отписаны от цитат и рассылок.').catch(tgError);
        return;
      }

      db.run('UPDATE users SET daily_enabled = 0, broadcast_enabled = 0 WHERE chat_id = ?', [chatId], (err2) => {
        if (err2) return console.error(err2);
        bot.sendMessage(chatId, '😔 Вы отписаны от ежедневных цитат и рассылок.\n\nВаша статистика сохранена. Возвращайтесь с /start когда захотите!').catch(tgError);
      });
    });
  });

  bot.onText(/\/quote(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const requestedId = match[1] ? Number(match[1]) : null;

    db.get('SELECT last_quote_time FROM users WHERE chat_id = ?', [chatId], async (err, row) => {
      const now = Date.now();
      const COOLDOWN_SEC = process.env.COOLDOWN_SEC ? Number(process.env.COOLDOWN_SEC) : 30;
      if (row && row.last_quote_time && now - row.last_quote_time < COOLDOWN_SEC * 1000) {
        const waitSec = Math.ceil((COOLDOWN_SEC * 1000 - (now - row.last_quote_time)) / 1000);
        return bot.sendMessage(chatId, `⏱️ Подождите ${waitSec} сек. перед следующей цитатой.`);
      }

      let q;
      if (requestedId) {
        q = getQuoteById(requestedId);
        if (!q) return bot.sendMessage(chatId, 'Нет цитаты с таким номером.');
      } else {
        q = getRandomQuote();
      }
      if (!q) return bot.sendMessage(chatId, 'База цитат пуста.');

      await sendQuote(bot, chatId, q);
      db.run('UPDATE users SET last_quote_time = ? WHERE chat_id = ?', [now, chatId]);
      
      // Записываем статистику прочтения
      recordQuoteRead(chatId, q.id, 'manual').catch(console.error);
    });
  });

  // Новая команда для статистики
  bot.onText(/\/mystats|\/stats/, (msg) => {
    const chatId = msg.chat.id;
    
    getUserStats(chatId).then(stats => {
      if (!stats) {
        bot.sendMessage(chatId, '📊 Статистика недоступна. Начните с команды /start!').catch(tgError);
        return;
      }
      
      const formattedStats = formatUserStats(stats);
      bot.sendMessage(chatId, formattedStats, { parse_mode: 'Markdown' }).catch(tgError);
    }).catch(err => {
      console.error('Error getting user stats:', err);
      bot.sendMessage(chatId, '❌ Ошибка при получении статистики.').catch(tgError);
    });
  });

  // Команда для топа пользователей
  bot.onText(/\/top|\/leaderboard/, (msg) => {
    const chatId = msg.chat.id;
    
    getLeaderboard(10).then(users => {
      if (!users.length) {
        bot.sendMessage(chatId, '🏆 Рейтинг пока пуст. Станьте первым!').catch(tgError);
        return;
      }
      
      let text = '🏆 **Топ пользователей по опыту:**\n\n';
      users.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const levelName = LEVELS[user.level] ? LEVELS[user.level].name : 'Неизвестно';
        text += `${medal} **${levelName}** (${user.level} ур.)\n`;
        text += `   📚 ${user.quotes_read_total || 0} цитат • ⭐ ${user.experience || 0} опыта\n`;
        text += `   🔥 Стрик: ${user.daily_streak || 0} дн.\n\n`;
      });
      
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(tgError);
    }).catch(err => {
      console.error('Error getting leaderboard:', err);
      bot.sendMessage(chatId, '❌ Ошибка при получении рейтинга.').catch(tgError);
    });
  });

  // Команда для информации об уровнях
  bot.onText(/\/levels/, (msg) => {
    const chatId = msg.chat.id;
    
    let text = '🎖️ **Система уровней:**\n\n';
    Object.entries(LEVELS).forEach(([level, info]) => {
      text += `**${level}. ${info.name}**\n`;
      text += `   💫 ${info.exp} опыта • 📚 ${info.quotes} цитат\n\n`;
    });
    
    text += '💡 *Получайте опыт за чтение цитат и выполнение достижений!*';
    
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(tgError);
  });

  // Команда для просмотра избранных цитат
  bot.onText(/\/favorites|\/fav/, (msg) => {
    const chatId = msg.chat.id;
    
    getFavoriteQuotes(chatId, 5, 0).then(quotes => {
      if (!quotes.length) {
        bot.sendMessage(chatId, '⭐ У вас пока нет избранных цитат.\n\nДобавляйте цитаты в избранное с помощью кнопки ⭐ под цитатой!').catch(tgError);
        return;
      }
      
      getFavoriteCount(chatId).then(total => {
        let text = `⭐ **Ваши избранные цитаты** (${quotes.length} из ${total}):\n\n`;
        
        quotes.forEach((quote, index) => {
          const date = new Date(quote.favorited_at).toLocaleDateString('ru-RU');
          text += `**${index + 1}.** ${quote.text}\n`;
          text += `   _Добавлено: ${date}_\n\n`;
        });
        
        if (total > 5) {
          text += `📚 Всего избранных: ${total}\n`;
          text += '🎲 Используйте /randomfav для случайной избранной цитаты';
        }
        
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(tgError);
      }).catch(err => {
        console.error('Error getting favorite count:', err);
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(tgError);
      });
    }).catch(err => {
      console.error('Error getting favorites:', err);
      bot.sendMessage(chatId, '❌ Ошибка при получении избранных цитат.').catch(tgError);
    });
  });

  // Команда для случайной избранной цитаты
  bot.onText(/\/randomfav/, (msg) => {
    const chatId = msg.chat.id;
    
    getRandomFavorite(chatId).then(quote => {
      if (!quote) {
        bot.sendMessage(chatId, '⭐ У вас пока нет избранных цитат.\n\nДобавляйте цитаты в избранное с помощью кнопки ⭐ под цитатой!').catch(tgError);
        return;
      }
      
      const formattedQuote = formatQuote(quote);
      const keyboard = {
        inline_keyboard: [
          [
            { text: '🎲 Ещё', callback_data: 'more' },
            { text: '⭐ Избранное', callback_data: `randomfav` }
          ]
        ]
      };
      
      bot.sendMessage(chatId, formattedQuote, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        disable_web_page_preview: true 
      }).catch(tgError);
      
      // Записываем статистику прочтения
      recordQuoteRead(chatId, quote.id, 'favorite').catch(console.error);
    }).catch(err => {
      console.error('Error getting random favorite:', err);
      bot.sendMessage(chatId, '❌ Ошибка при получении случайной избранной цитаты.').catch(tgError);
    });
  });

  // ==================== НОВЫЕ КОМАНДЫ ПОИСКА ====================

  // Универсальный поиск (обновленный /find)
  bot.onText(/\/find\s+(.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1];
    if (!query.trim()) return bot.sendMessage(chatId, 'Введите текст для поиска.');
    
    const results = advancedSearch(query, 'all', 5);
    if (!results.length) return bot.sendMessage(chatId, '🔍 Ничего не найдено.');
    
    const text = results.map((r) => formatSearchResult(r, true)).join('\n\n---\n\n');
    bot.sendMessage(chatId, text, { disable_web_page_preview: true, parse_mode: 'Markdown' });
  });

  // Поиск по автору
  bot.onText(/\/author\s+(.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const authorQuery = match[1];
    if (!authorQuery.trim()) return bot.sendMessage(chatId, 'Введите имя автора для поиска.');
    
    const results = searchByAuthor(authorQuery, 7);
    if (!results.length) {
      bot.sendMessage(chatId, `🔍 Цитаты автора "${authorQuery}" не найдены.\n\nИспользуйте /authors для просмотра списка авторов.`);
      return;
    }
    
    let text = `👤 **Цитаты автора:** ${results[0].author || authorQuery}\n\n`;
    text += results.map((r) => formatSearchResult(r, false)).join('\n\n---\n\n');
    
    bot.sendMessage(chatId, text, { disable_web_page_preview: true, parse_mode: 'Markdown' });
  });

  // Поиск по теме
  bot.onText(/\/theme\s+(.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const themeQuery = match[1];
    if (!themeQuery.trim()) return bot.sendMessage(chatId, 'Введите тему для поиска.');
    
    const results = searchByTheme(themeQuery, 7);
    if (!results.length) {
      bot.sendMessage(chatId, `🔍 Цитаты по теме "${themeQuery}" не найдены.\n\nИспользуйте /themes для просмотра списка тем.`);
      return;
    }
    
    let text = `🏷️ **Цитаты по теме:** ${results[0].theme || themeQuery}\n\n`;
    text += results.map((r) => formatSearchResult(r, false)).join('\n\n---\n\n');
    
    bot.sendMessage(chatId, text, { disable_web_page_preview: true, parse_mode: 'Markdown' });
  });

  // Список всех авторов
  bot.onText(/\/authors/, (msg) => {
    const chatId = msg.chat.id;
    
    const authors = getAllAuthors();
    if (!authors.length) {
      bot.sendMessage(chatId, '📝 В базе пока нет информации об авторах цитат.');
      return;
    }
    
    let text = `👥 **Авторы в базе** (${authors.length}):\n\n`;
    
    // Показываем первые 20 авторов
    const displayAuthors = authors.slice(0, 20);
    displayAuthors.forEach((author, index) => {
      text += `${index + 1}. ${author}\n`;
    });
    
    if (authors.length > 20) {
      text += `\n... и ещё ${authors.length - 20}\n`;
    }
    
    text += '\n💡 Используйте `/author имя` для поиска цитат автора';
    
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  // Список всех тем
  bot.onText(/\/themes/, (msg) => {
    const chatId = msg.chat.id;
    
    const themes = getAllThemes();
    if (!themes.length) {
      bot.sendMessage(chatId, '🏷️ В базе пока нет информации о темах цитат.');
      return;
    }
    
    let text = `🏷️ **Темы в базе** (${themes.length}):\n\n`;
    
    // Показываем первые 20 тем
    const displayThemes = themes.slice(0, 20);
    displayThemes.forEach((theme, index) => {
      text += `${index + 1}. ${theme}\n`;
    });
    
    if (themes.length > 20) {
      text += `\n... и ещё ${themes.length - 20}\n`;
    }
    
    text += '\n💡 Используйте `/theme название` для поиска цитат по теме';
    
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  // Статистика поиска
  bot.onText(/\/searchstats/, (msg) => {
    const chatId = msg.chat.id;
    
    const stats = getSearchStats();
    let text = `📊 **Статистика поиска:**\n\n`;
    text += `📚 Всего цитат: ${stats.total}\n`;
    text += `👤 С указанием автора: ${stats.withAuthor}\n`;
    text += `🏷️ С указанием темы: ${stats.withTheme}\n`;
    text += `📖 С указанием источника: ${stats.withSource}\n\n`;
    text += `👥 Уникальных авторов: ${stats.uniqueAuthors}\n`;
    text += `🏷️ Уникальных тем: ${stats.uniqueThemes}`;
    
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/time\s+(\d{2}:\d{2})/, (msg, match) => {
    const chatId = msg.chat.id;
    const timeStr = match[1];
    if (!isValidTime(timeStr)) return bot.sendMessage(chatId, 'Неверный формат времени. Пример: /time 08:30');

    db.get('SELECT daily_time FROM users WHERE chat_id = ?', [chatId], (err, row) => {
      if (err) return console.error(err);

      if (row && row.daily_time === timeStr) {
        bot.sendMessage(chatId, `⏰ Время уже установлено на ${timeStr}.`).catch(tgError);
        return;
      }

      db.run('UPDATE users SET daily_time = ? WHERE chat_id = ?', [timeStr, chatId], (err2) => {
        if (err2) return console.error(err2);
        bot.sendMessage(chatId, `⏰ Время ежедневной цитаты изменено на ${timeStr}.`).catch(tgError);
      });
    });
  });

  bot.onText(/\/randomtime/, (msg) => {
    const chatId = msg.chat.id;
    const h = Math.floor(Math.random() * 24)
      .toString()
      .padStart(2, '0');
    const m = Math.floor(Math.random() * 60)
      .toString()
      .padStart(2, '0');
    const randomT = `${h}:${m}`;
    db.run('UPDATE users SET daily_time = ? WHERE chat_id = ?', [randomT, chatId], (err) => {
      if (err) return console.error(err);
      bot.sendMessage(chatId, `🎲 Случайное время установлено: ${randomT}.`);
    });
  });

  bot.onText(/\/tz\s+([\w/]+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const tz = match[1];
    if (!DateTime.now().setZone(tz).isValid) return bot.sendMessage(chatId, 'Неверный таймзон. Пример: Europe/Chisinau');

    db.get('SELECT timezone FROM users WHERE chat_id = ?', [chatId], (err, row) => {
      if (err) return console.error(err);

      if (row && row.timezone === tz) {
        bot.sendMessage(chatId, `🌍 Часовой пояс уже установлен: ${tz}.`).catch(tgError);
        return;
      }

      db.run('UPDATE users SET timezone = ? WHERE chat_id = ?', [tz, chatId], (err2) => {
        if (err2) return console.error(err2);
        bot.sendMessage(chatId, `🌍 Часовой пояс обновлён: ${tz}.`).catch(tgError);
      });
    });
  });

  bot.onText(/\/count/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `📚 Всего цитат в базе: ${getQuotesCount()}`);
  });

  // Команда для получения ИИ объяснения цитаты
  bot.onText(/\/explain(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    // Проверяем, включена ли функция объяснений
    if (!isExplanationsEnabled()) {
      return bot.sendMessage(chatId, '🚫 Функция ИИ объяснений временно недоступна.\n\n💡 Возможные причины:\n• Превышена квота OpenAI\n• Технические проблемы\n\n👨‍💼 Обратитесь к администратору для решения вопроса.');
    }

    const requestedId = match[1] ? Number(match[1]) : null;

    try {
      let quote;
      if (requestedId) {
        quote = getQuoteById(requestedId);
        if (!quote) {
          return bot.sendMessage(chatId, '❌ Цитата с таким номером не найдена.');
        }
      } else {
        // Если номер не указан, берем последнюю показанную цитату или случайную
        quote = getRandomQuote();
        if (!quote) {
          return bot.sendMessage(chatId, '❌ База цитат пуста.');
        }
      }

      // Отправляем сообщение о процессе генерации
      const loadingMessage = await bot.sendMessage(chatId, '💡 Генерирую объяснение... Это может занять несколько секунд.');

      // Генерируем объяснение
      const explanation = await generateQuoteExplanation(quote);
      const formattedExplanation = formatExplanation(quote, explanation);

      // Удаляем сообщение о загрузке
      await bot.deleteMessage(chatId, loadingMessage.message_id).catch(tgError);

      // Отправляем объяснение
      await bot.sendMessage(chatId, formattedExplanation, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });

    } catch (error) {
      console.error('Error in /explain command:', error);
      bot.sendMessage(chatId, '❌ Произошла ошибка при создании объяснения. Попробуйте позже.').catch(tgError);
    }
  });

  // Функция для создания интерактивного меню помощи
  function createHelpMenu(isAdminUser = false) {
    const mainText = `🕊️ **Добро пожаловать в Bahai Quote Bot!**

🌟 *Ваш путеводитель по мудрости Бахаи*

Этот бот поможет вам:
• 📚 Открывать новые духовные истины
• 🌅 Получать ежедневную порцию вдохновения  
• ⭐ Собирать личную коллекцию цитат
• 📊 Отслеживать свой духовный рост
• 🔍 Находить ответы на жизненные вопросы

Выберите раздел для подробной информации:`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🚀 Основные команды', callback_data: 'help_basic' },
          { text: '🔍 Поиск цитат', callback_data: 'help_search' }
        ],
        [
          { text: '⭐ Избранное', callback_data: 'help_favorites' },
          { text: '⚙️ Настройки', callback_data: 'help_settings' }
        ],
        [
          { text: '📊 Статистика', callback_data: 'help_stats' },
          { text: '🎯 Быстрый старт', callback_data: 'help_quickstart' }
        ]
      ]
    };

    // Добавляем админскую кнопку если пользователь админ
    if (isAdminUser) {
      keyboard.inline_keyboard.push([
        { text: '👨‍💼 Админ команды', callback_data: 'help_admin' }
      ]);
    }

    // Добавляем кнопку "Получить цитату"
    keyboard.inline_keyboard.push([
      { text: '🎲 Получить случайную цитату', callback_data: 'more' }
    ]);

    return { text: mainText, keyboard };
  }

  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;

    isAdmin(chatId, (err, ok) => {
      const helpMenu = createHelpMenu(!!ok && !err);
      
      bot.sendMessage(chatId, helpMenu.text, { 
        parse_mode: 'Markdown',
        reply_markup: helpMenu.keyboard 
      }).catch(tgError);
    });
  });

  // ---------------- ADMIN COMMANDS ----------------
  
  // Команда /push - разовая рассылка
  bot.onText(/\/push\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    
    isAdmin(chatId, (err, ok) => {
      if (err || !ok) {
        return bot.sendMessage(chatId, '❌ У вас нет прав администратора.').catch(tgError);
      }
      
      const [, date, time, message] = match;
      
      try {
        const { DateTime } = require('luxon');
        const localDt = DateTime.fromISO(`${date}T${time}`, { zone: DEFAULT_TZ });
        
        if (!localDt.isValid) {
          return bot.sendMessage(chatId, '❌ Неверный формат даты/времени.\nПример: /push 2025-12-31 15:30 Текст сообщения').catch(tgError);
        }
        
        if (localDt < DateTime.now()) {
          return bot.sendMessage(chatId, '❌ Время должно быть в будущем.').catch(tgError);
        }
        
        const iso = localDt.toUTC().toISO();
        
        db.run('INSERT INTO broadcasts(type, schedule, message) VALUES ("push", ?, ?)', 
          [iso, message], 
          function(err) {
            if (err) {
              console.error('Error creating push broadcast:', err);
              return bot.sendMessage(chatId, '❌ Ошибка при создании рассылки.').catch(tgError);
            }
            
            bot.sendMessage(chatId, 
              `✅ Разовая рассылка создана!\n\n` +
              `📅 Дата: ${date} ${time}\n` +
              `💬 Сообщение: ${message}\n` +
              `🆔 ID: ${this.lastID}`
            ).catch(tgError);
          }
        );
        
      } catch (error) {
        console.error('Error in /push command:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка при обработке команды.').catch(tgError);
      }
    });
  });
  
  // Команда /weekly - еженедельная рассылка
  bot.onText(/\/weekly\s+([1-7])\s+(\d{2}:\d{2})\s+(.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    
    isAdmin(chatId, (err, ok) => {
      if (err || !ok) {
        return bot.sendMessage(chatId, '❌ У вас нет прав администратора.').catch(tgError);
      }
      
      const [, day, time, message] = match;
      const schedule = `${day}|${time}`;
      const dayNames = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
      
      db.run('INSERT INTO broadcasts(type, schedule, message) VALUES ("weekly", ?, ?)', 
        [schedule, message], 
        function(err) {
          if (err) {
            console.error('Error creating weekly broadcast:', err);
            return bot.sendMessage(chatId, '❌ Ошибка при создании рассылки.').catch(tgError);
          }
          
          bot.sendMessage(chatId, 
            `✅ Еженедельная рассылка создана!\n\n` +
            `📅 День: ${dayNames[day]} в ${time}\n` +
            `💬 Сообщение: ${message}\n` +
            `🆔 ID: ${this.lastID}`
          ).catch(tgError);
        }
      );
    });
  });
  
  // Команда /daily - ежедневная рассылка (новая)
  bot.onText(/\/dailycast\s+(\d{2}:\d{2})\s+(.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    
    isAdmin(chatId, (err, ok) => {
      if (err || !ok) {
        return bot.sendMessage(chatId, '❌ У вас нет прав администратора.').catch(tgError);
      }
      
      const [, time, message] = match;
      
      db.run('INSERT INTO broadcasts(type, schedule, message) VALUES ("daily", ?, ?)', 
        [time, message], 
        function(err) {
          if (err) {
            console.error('Error creating daily broadcast:', err);
            return bot.sendMessage(chatId, '❌ Ошибка при создании рассылки.').catch(tgError);
          }
          
          bot.sendMessage(chatId, 
            `✅ Ежедневная рассылка создана!\n\n` +
            `⏰ Время: каждый день в ${time}\n` +
            `💬 Сообщение: ${message}\n` +
            `🆔 ID: ${this.lastID}`
          ).catch(tgError);
        }
      );
    });
  });
  
  // Команда /blist - список рассылок
  bot.onText(/\/blist(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    
    isAdmin(chatId, (err, ok) => {
      if (err || !ok) {
        return bot.sendMessage(chatId, '❌ У вас нет прав администратора.').catch(tgError);
      }
      
      const limit = match[1] ? parseInt(match[1]) : 10;
      
      db.all('SELECT * FROM broadcasts ORDER BY id DESC LIMIT ?', [limit], (err, rows) => {
        if (err) {
          console.error('Error fetching broadcasts:', err);
          return bot.sendMessage(chatId, '❌ Ошибка при получении рассылок.').catch(tgError);
        }
        
        if (!rows.length) {
          return bot.sendMessage(chatId, '📭 Нет рассылок.').catch(tgError);
        }
        
        const timeManager = require('../core/timeUtils');
        let text = `📋 **Последние рассылки** (${rows.length}):\n\n`;
        
        rows.forEach(broadcast => {
          let scheduleText = broadcast.schedule;
          const status = broadcast.sent ? '✅ Отправлено' : '⏳ Ожидает';
          
          // Форматируем расписание для читаемости
          if (broadcast.type === 'push') {
            scheduleText = timeManager.formatForDisplay(broadcast.schedule, 'dd.MM.yyyy HH:mm');
          } else if (broadcast.type === 'weekly') {
            const [day, time] = broadcast.schedule.split('|');
            const dayNames = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
            scheduleText = `${dayNames[day]} в ${time}`;
          } else if (broadcast.type === 'daily') {
            scheduleText = `Ежедневно в ${broadcast.schedule}`;
          }
          
          text += `**#${broadcast.id}** | ${broadcast.type.toUpperCase()}\n`;
          text += `📅 ${scheduleText}\n`;
          text += `📊 ${status}\n`;
          text += `💬 ${broadcast.message.length > 50 ? broadcast.message.substring(0, 50) + '...' : broadcast.message}\n\n`;
        });
        
        text += `💡 Используйте /bdel ID для удаления\n`;
        text += `✏️ Используйте /bedit ID текст для изменения`;
        
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(tgError);
      });
    });
  });
  
  // Команда /bdel - удаление рассылки
  bot.onText(/\/bdel\s+(\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    
    isAdmin(chatId, (err, ok) => {
      if (err || !ok) {
        return bot.sendMessage(chatId, '❌ У вас нет прав администратора.').catch(tgError);
      }
      
      const broadcastId = parseInt(match[1]);
      
      db.get('SELECT * FROM broadcasts WHERE id = ?', [broadcastId], (err, row) => {
        if (err) {
          console.error('Error fetching broadcast:', err);
          return bot.sendMessage(chatId, '❌ Ошибка при поиске рассылки.').catch(tgError);
        }
        
        if (!row) {
          return bot.sendMessage(chatId, `❌ Рассылка #${broadcastId} не найдена.`).catch(tgError);
        }
        
        db.run('DELETE FROM broadcasts WHERE id = ?', [broadcastId], (err) => {
          if (err) {
            console.error('Error deleting broadcast:', err);
            return bot.sendMessage(chatId, '❌ Ошибка при удалении рассылки.').catch(tgError);
          }
          
          bot.sendMessage(chatId, 
            `✅ Рассылка удалена!\n\n` +
            `🆔 ID: #${broadcastId}\n` +
            `📝 Тип: ${row.type}\n` +
            `💬 Было: ${row.message.substring(0, 100)}${row.message.length > 100 ? '...' : ''}`
          ).catch(tgError);
        });
      });
    });
  });
  
  // Команда /bedit - редактирование рассылки
  bot.onText(/\/bedit\s+(\d+)\s+(.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    
    isAdmin(chatId, (err, ok) => {
      if (err || !ok) {
        return bot.sendMessage(chatId, '❌ У вас нет прав администратора.').catch(tgError);
      }
      
      const [, broadcastId, newMessage] = match;
      const id = parseInt(broadcastId);
      
      db.get('SELECT * FROM broadcasts WHERE id = ?', [id], (err, row) => {
        if (err) {
          console.error('Error fetching broadcast:', err);
          return bot.sendMessage(chatId, '❌ Ошибка при поиске рассылки.').catch(tgError);
        }
        
        if (!row) {
          return bot.sendMessage(chatId, `❌ Рассылка #${id} не найдена.`).catch(tgError);
        }
        
        if (row.sent) {
          return bot.sendMessage(chatId, `❌ Нельзя редактировать уже отправленную рассылку #${id}.`).catch(tgError);
        }
        
        db.run('UPDATE broadcasts SET message = ? WHERE id = ?', [newMessage, id], (err) => {
          if (err) {
            console.error('Error updating broadcast:', err);
            return bot.sendMessage(chatId, '❌ Ошибка при обновлении рассылки.').catch(tgError);
          }
          
          bot.sendMessage(chatId, 
            `✅ Рассылка обновлена!\n\n` +
            `🆔 ID: #${id}\n` +
            `📝 Тип: ${row.type}\n` +
            `💬 Новый текст: ${newMessage}`
          ).catch(tgError);
        });
      });
    });
  });
  
     // Команда /astats - статистика для админов
   bot.onText(/\/astats/, (msg) => {
     const chatId = msg.chat.id;
     
     isAdmin(chatId, (err, ok) => {
       if (err || !ok) {
         return bot.sendMessage(chatId, '❌ У вас нет прав администратора.').catch(tgError);
       }
       
       // Получаем статистику
       db.get('SELECT COUNT(*) as users FROM users', (err1, usersResult) => {
         db.get('SELECT COUNT(*) as quotes FROM quotes', (err2, quotesResult) => {
           db.get('SELECT COUNT(*) as broadcasts FROM broadcasts', (err3, broadcastsResult) => {
             db.get('SELECT COUNT(*) as pending FROM broadcasts WHERE sent = 0', (err4, pendingResult) => {
               db.get('SELECT COUNT(*) as admins FROM admins', (err5, adminsResult) => {
                 
                 if (err1 || err2 || err3 || err4 || err5) {
                   console.error('Error getting admin stats:', err1 || err2 || err3 || err4 || err5);
                   return bot.sendMessage(chatId, '❌ Ошибка при получении статистики.').catch(tgError);
                 }
                 
                 const text = 
                   `📊 **Статистика бота:**\n\n` +
                   `👥 Пользователи: ${usersResult.users}\n` +
                   `👨‍💼 Администраторы: ${adminsResult.admins}\n` +
                   `📚 Цитаты: ${quotesResult.quotes}\n` +
                   `📡 Всего рассылок: ${broadcastsResult.broadcasts}\n` +
                   `⏳ Ожидают отправки: ${pendingResult.pending}\n\n` +
                   `💡 Используйте /blist для просмотра рассылок\n` +
                   `🔧 Веб-панель: http://localhost:3000`;
                 
                 bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(tgError);
               });
             });
           });
         });
       });
     });
   });
   
   // Команда /admins - список админов
   bot.onText(/\/admins/, (msg) => {
     const chatId = msg.chat.id;
     
     isAdmin(chatId, (err, ok) => {
       if (err || !ok) {
         return bot.sendMessage(chatId, '❌ У вас нет прав администратора.').catch(tgError);
       }
       
       db.all('SELECT chat_id, notifications_enabled FROM admins ORDER BY chat_id', (err, rows) => {
         if (err) {
           console.error('Error getting admins:', err);
           return bot.sendMessage(chatId, '❌ Ошибка при получении списка админов.').catch(tgError);
         }
         
         if (!rows.length) {
           return bot.sendMessage(chatId, '👨‍💼 Нет администраторов.').catch(tgError);
         }
         
         let text = `👨‍💼 **Администраторы бота** (${rows.length}):\n\n`;
         rows.forEach((admin, index) => {
           const notifStatus = admin.notifications_enabled ? '🔔' : '🔕';
           text += `${index + 1}. \`${admin.chat_id}\` ${notifStatus}\n`;
         });
         
         text += `\n💡 Добавить админа: используйте веб-панель или SQL\n`;
         text += `🔔 Управление уведомлениями: /notif`;
         
         bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(tgError);
       });
     });
   });

   // Команда /notif - управление уведомлениями администратора
   bot.onText(/\/notif(?:\s+(on|off))?/, (msg, match) => {
     const chatId = msg.chat.id;
     
     isAdmin(chatId, (err, ok) => {
       if (err || !ok) {
         return bot.sendMessage(chatId, '❌ У вас нет прав администратора.').catch(tgError);
       }
       
       const action = match[1];
       
       if (!action) {
         // Показываем текущий статус
         db.get('SELECT notifications_enabled FROM admins WHERE chat_id = ?', [chatId], (err, row) => {
           if (err) {
             console.error('Error getting notification status:', err);
             return bot.sendMessage(chatId, '❌ Ошибка при получении статуса уведомлений.').catch(tgError);
           }
           
           if (!row) {
             return bot.sendMessage(chatId, '❌ Вы не найдены в списке администраторов.').catch(tgError);
           }
           
           const status = row.notifications_enabled ? 'включены' : 'отключены';
           const icon = row.notifications_enabled ? '🔔' : '🔕';
           const toggleAction = row.notifications_enabled ? 'off' : 'on';
           const toggleText = row.notifications_enabled ? 'отключить' : 'включить';
           
           const text = `${icon} **Ваши уведомления ${status}**\n\n` +
                       `📋 Уведомления о состоянии бота:\n` +
                       `• Запуск/остановка бота\n` +
                       `• Перезапуск бота\n` +
                       `• Ошибки и сбои\n\n` +
                       `💡 Чтобы ${toggleText} уведомления, используйте:\n` +
                       `/notif ${toggleAction}`;
           
           bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(tgError);
         });
       } else {
         // Изменяем статус уведомлений
         const newStatus = action === 'on' ? 1 : 0;
         const statusText = action === 'on' ? 'включены' : 'отключены';
         const icon = action === 'on' ? '🔔' : '🔕';
         
         db.run('UPDATE admins SET notifications_enabled = ? WHERE chat_id = ?', 
           [newStatus, chatId], 
           function(err) {
             if (err) {
               console.error('Error updating notification status:', err);
               return bot.sendMessage(chatId, '❌ Ошибка при обновлении настроек.').catch(tgError);
             }
             
             if (this.changes === 0) {
               return bot.sendMessage(chatId, '❌ Вы не найдены в списке администраторов.').catch(tgError);
             }
             
             const message = `${icon} **Уведомления ${statusText}!**\n\n` +
                           `${action === 'on' ? 
                             'Теперь вы будете получать уведомления о состоянии бота.' : 
                             'Вы больше не будете получать уведомления о состоянии бота.'}`;
             
             bot.sendMessage(chatId, message, { parse_mode: 'Markdown' }).catch(tgError);
           }
         );
       }
     });
   });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    
    if (query.data === 'more') {
      const q = getRandomQuote();
      if (q) {
        await sendQuote(bot, chatId, q);
        // Записываем статистику прочтения
        recordQuoteRead(chatId, q.id, 'manual').catch(console.error);
      }
    } else if (query.data === 'randomfav') {
      try {
        const quote = await getRandomFavorite(chatId);
        if (quote) {
          const formattedQuote = formatQuote(quote);
          const keyboard = {
            inline_keyboard: [
              [
                { text: '🎲 Ещё', callback_data: 'more' },
                { text: '⭐ Избранное', callback_data: `randomfav` }
              ]
            ]
          };
          
          await bot.sendMessage(chatId, formattedQuote, { 
            parse_mode: 'Markdown',
            reply_markup: keyboard,
            disable_web_page_preview: true 
          });
          
          recordQuoteRead(chatId, quote.id, 'favorite').catch(console.error);
        } else {
          bot.sendMessage(chatId, '⭐ У вас пока нет избранных цитат!').catch(tgError);
        }
      } catch (error) {
        console.error('Error getting random favorite:', error);
        bot.sendMessage(chatId, '❌ Ошибка при получении избранной цитаты.').catch(tgError);
      }
    } else if (query.data.startsWith('fav_')) {
      const quoteId = parseInt(query.data.split('_')[1]);
      try {
        const isCurrentlyFav = await isFavorite(chatId, quoteId);
        
        if (isCurrentlyFav) {
          const removed = await removeFromFavorites(chatId, quoteId);
          if (removed) {
            bot.answerCallbackQuery(query.id, { text: '💔 Удалено из избранного' }).catch(tgError);
          } else {
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка при удалении' }).catch(tgError);
          }
        } else {
          const added = await addToFavorites(chatId, quoteId);
          if (added) {
            bot.answerCallbackQuery(query.id, { text: '⭐ Добавлено в избранное!' }).catch(tgError);
            // Проверяем достижения за добавление в избранное
            checkFavoriteAchievements(chatId).then(achievements => {
              notifyAchievements(chatId, achievements);
            }).catch(console.error);
          } else {
            bot.answerCallbackQuery(query.id, { text: '💭 Уже в избранном' }).catch(tgError);
          }
        }
        
        // Обновляем кнопки в сообщении
        const quote = getQuoteById(quoteId);
        if (quote) {
          const newIsFav = await isFavorite(chatId, quoteId);
          const favoriteText = newIsFav ? '⭐ Убрать' : '⭐ Добавить';
          
          const newKeyboard = {
            inline_keyboard: [
              [
                { text: '🔄 Ещё', callback_data: 'more' },
                { text: favoriteText, callback_data: `fav_${quoteId}` }
              ]
            ]
          };
          
          // Добавляем кнопку объяснения только если функция включена
          if (isExplanationsEnabled()) {
            newKeyboard.inline_keyboard.push([
              { text: '💡 Объяснить', callback_data: `explain_${quoteId}` }
            ]);
          }
          
          bot.editMessageReplyMarkup(newKeyboard, {
            chat_id: chatId,
            message_id: query.message.message_id
          }).catch(tgError);
        }
      } catch (error) {
        console.error('Error handling favorite:', error);
        bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' }).catch(tgError);
      }
    } else if (query.data.startsWith('explain_')) {
      const quoteId = parseInt(query.data.split('_')[1]);
      
      // Проверяем, включена ли функция объяснений
      if (!isExplanationsEnabled()) {
        bot.answerCallbackQuery(query.id, { 
          text: '🚫 Функция ИИ объяснений временно недоступна',
          show_alert: true 
        }).catch(tgError);
        return;
      }
      
      try {
        const quote = getQuoteById(quoteId);
        if (!quote) {
          bot.answerCallbackQuery(query.id, { text: '❌ Цитата не найдена' }).catch(tgError);
          return;
        }

        // Сразу отвечаем на callback, чтобы убрать "loading"
        bot.answerCallbackQuery(query.id, { text: '💡 Генерирую объяснение...' }).catch(tgError);

        // Отправляем loading сообщение
        const loadingMessage = await bot.sendMessage(chatId, '💡 Генерирую объяснение... Это может занять несколько секунд.');

        // Генерируем объяснение
        const explanation = await generateQuoteExplanation(quote);
        const formattedExplanation = formatExplanation(quote, explanation);

        // Удаляем сообщение о загрузке
        await bot.deleteMessage(chatId, loadingMessage.message_id).catch(tgError);

        // Отправляем объяснение
        await bot.sendMessage(chatId, formattedExplanation, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true 
        });

      } catch (error) {
        console.error('Error handling explain callback:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка при создании объяснения. Попробуйте позже.').catch(tgError);
      }
    } else if (query.data.startsWith('help_')) {
      // Обработка help кнопок
      const section = query.data.split('_')[1];
      
      // Общая кнопка "Назад в меню"
      const backButton = { text: '🔙 Назад в меню', callback_data: 'help_main' };
      
      let helpText = '';
      let keyboard = { inline_keyboard: [[backButton]] };
      
      if (section === 'main') {
        // Возврат в главное меню помощи
        isAdmin(chatId, (err, ok) => {
          const helpMenu = createHelpMenu(!!ok && !err);
          bot.editMessageText(helpMenu.text, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: helpMenu.keyboard
          }).catch(tgError);
        });
        bot.answerCallbackQuery(query.id).catch(tgError);
        return;
      } else if (section === 'basic') {
        helpText = `🚀 **Основные команды:**

/start – подписаться на ежедневные цитаты
/stop – отписаться от всех уведомлений  
/quote [N] – получить случайную или конкретную цитату
/count – узнать количество цитат в базе`;

        if (isExplanationsEnabled()) {
          helpText += '\n/explain [N] – получить ИИ объяснение цитаты';
        }

        helpText += '\n\n💡 **Пример:** \`/quote 123\` покажет цитату №123';
        
      } else if (section === 'search') {
        helpText = `🔍 **Поиск цитат:**

**Универсальный поиск:**
/find текст – поиск по всем полям

**Поиск по категориям:**
/author имя – поиск по автору
/theme тема – поиск по теме

**Списки:**
/authors – все авторы в базе  
/themes – все темы в базе
/searchstats – статистика поиска

💡 **Примеры:**
• \`/find любовь\` – найти все цитаты о любви
• \`/author Бахаулла\` – цитаты Бахауллы
• \`/theme единство\` – цитаты на тему единства`;

      } else if (section === 'favorites') {
        helpText = `⭐ **Избранные цитаты:**

/favorites – ваши избранные цитаты (последние 5)
/randomfav – случайная цитата из избранного

**Как добавить в избранное:**
1. Получите цитату командой /quote
2. Нажмите кнопку ⭐ под цитатой
3. Цитата сохранится в вашем избранном

💎 **Коллекционируйте самые важные для вас цитаты!**`;

      } else if (section === 'settings') {
        helpText = `⚙️ **Настройки:**

**Время доставки:**
/time HH:MM – установить время ежедневной цитаты
/randomtime – установить случайное время

**Часовой пояс:**
/tz Area/City – изменить часовой пояс

**Уведомления:**
/daily on|off – включить/отключить ежедневные цитаты
/broadcast on|off – включить/отключить рассылки

💡 **Примеры:**
• \`/time 08:30\` – цитаты в 8:30 утра
• \`/tz Europe/London\` – лондонское время
• \`/daily on\` – включить ежедневные цитаты`;

      } else if (section === 'stats') {
        helpText = `📊 **Статистика и достижения:**

/mystats – ваша подробная статистика
/top – рейтинг топ-10 пользователей  
/levels – система уровней и достижений

**Что отслеживается:**
• 📚 Количество прочитанных цитат
• 🔥 Ежедневные стрики чтения
• ⭐ Опыт и уровень развития
• 🏆 Разблокированные достижения

🎯 **Читайте цитаты каждый день и растите духовно!**`;

      } else if (section === 'quickstart') {
        helpText = `🎯 **Быстрый старт:**

**1. Подпишитесь на цитаты:**
\`/start\` – начать получать ежедневные цитаты

**2. Получите первую цитату:**
\`/quote\` – случайная цитата с кнопками действий

**3. Настройте время:**
\`/time 09:00\` – получать цитаты в 9 утра

**4. Попробуйте поиск:**
\`/find мудрость\` – найти цитаты о мудрости

**5. Собирайте избранное:**
Нажимайте ⭐ под понравившимися цитатами

🌟 **Готово! Наслаждайтесь мудростью Бахаи каждый день!**`;

        // Добавляем быстрые кнопки
        keyboard.inline_keyboard.unshift([
          { text: '🎲 Получить цитату', callback_data: 'more' },
          { text: '📊 Моя статистика', callback_data: 'quick_stats' }
        ]);

      } else if (section === 'admin') {
        // Проверяем права админа
        isAdmin(chatId, (err, ok) => {
          if (err || !ok) {
            bot.answerCallbackQuery(query.id, { 
              text: '❌ У вас нет прав администратора',
              show_alert: true 
            }).catch(tgError);
            return;
          }
          
          const adminText = `👨‍💼 **Админ команды:**

**📡 Рассылки:**
/push 2025-12-31 15:30 текст – разовая рассылка
/weekly 1 09:00 текст – еженедельная (1=Пн, 7=Вс)  
/dailycast 21:00 текст – ежедневная рассылка
/blist [10] – список рассылок
/bdel 123 – удалить рассылку по ID
/bedit 123 новый текст – изменить текст

**🔧 Управление:**
/astats – статистика бота
/admins – список администраторов
/notif [on|off] – управление уведомлениями

💡 **Примеры:**
• \`/push 2025-06-15 18:00 Важное объявление!\`
• \`/weekly 5 20:00 Еженедельная мотивация\`
• \`/dailycast 08:00 Доброе утро!\`
• \`/notif off\` – отключить уведомления о состоянии бота

🌐 **Веб-панель:** http://localhost:3000`;

          bot.editMessageText(adminText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: keyboard
          }).catch(tgError);
        });
        bot.answerCallbackQuery(query.id).catch(tgError);
        return;
      }
      
      if (helpText) {
        bot.editMessageText(helpText, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        }).catch(tgError);
      }
      
      bot.answerCallbackQuery(query.id).catch(tgError);
    } else if (query.data === 'quick_stats') {
      // Быстрая статистика из quickstart
      getUserStats(chatId).then(stats => {
        if (!stats) {
          bot.answerCallbackQuery(query.id, { 
            text: '📊 Начните с команды /start для получения статистики!',
            show_alert: true 
          }).catch(tgError);
          return;
        }
        
        const levelName = LEVELS[stats.level] ? LEVELS[stats.level].name : 'Новичок';
        const shortStats = `📊 **Ваша статистика:**\n\n` +
          `🎖️ Уровень: ${stats.level} (${levelName})\n` +
          `📚 Прочитано цитат: ${stats.quotesRead || 0}\n` +
          `🔥 Текущий стрик: ${stats.dailyStreak || 0} дн.\n` +
          `⭐ Опыт: ${stats.experience || 0}`;

        bot.answerCallbackQuery(query.id, { 
          text: shortStats,
          show_alert: true 
        }).catch(tgError);
      }).catch(err => {
        console.error('Error getting quick stats:', err);
        bot.answerCallbackQuery(query.id, { text: '❌ Ошибка получения статистики' }).catch(tgError);
      });
    } else {
      bot.answerCallbackQuery(query.id).catch(tgError);
    }
  });

  // Toggle daily quotes on/off
  bot.onText(/\/daily\s+(on|off)/i, (msg, match) => {
    const chatId = msg.chat.id;
    const val = match[1].toLowerCase() === 'on' ? 1 : 0;

    db.get('SELECT daily_enabled FROM users WHERE chat_id = ?', [chatId], (err, row) => {
      if (err) return console.error(err);

      if (row && row.daily_enabled === val) {
        bot.sendMessage(chatId, `Ежедневные цитаты уже ${val ? 'включены' : 'отключены'}.`).catch(tgError);
        return;
      }

      db.run('UPDATE users SET daily_enabled = ? WHERE chat_id = ?', [val, chatId], (err2) => {
        if (err2) return console.error(err2);
        bot.sendMessage(chatId, `Ежедневные цитаты ${val ? 'включены' : 'отключены'}.`).catch(tgError);
      });
    });
  });

  // Toggle broadcasts on/off
  bot.onText(/\/broadcast\s+(on|off)/i, (msg, match) => {
    const chatId = msg.chat.id;
    const val = match[1].toLowerCase() === 'on' ? 1 : 0;

    db.get('SELECT broadcast_enabled FROM users WHERE chat_id = ?', [chatId], (err, row) => {
      if (err) return console.error(err);

      if (row && row.broadcast_enabled === val) {
        bot.sendMessage(chatId, `Бродкасты уже ${val ? 'включены' : 'отключены'}.`).catch(tgError);
        return;
      }

      db.run('UPDATE users SET broadcast_enabled = ? WHERE chat_id = ?', [val, chatId], (err2) => {
        if (err2) return console.error(err2);
        bot.sendMessage(chatId, `Бродкасты ${val ? 'включены' : 'отключены'}.`).catch(tgError);
      });
    });
  });
}

module.exports = { registerCommands }; 