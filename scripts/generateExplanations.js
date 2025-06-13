#!/usr/bin/env node

require('dotenv').config();
const { db, initDatabase } = require('../src/core/db');
const { generateQuoteExplanation, getExplanationStats } = require('../src/bot/aiExplainer');

async function generateExplanationsForAllQuotes() {
  console.log('🧠 Запуск генерации ИИ объяснений для всех цитат...\n');

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY не найден в переменных окружения!');
    console.log('💡 Добавьте ключ в файл .env: OPENAI_API_KEY=sk-...');
    process.exit(1);
  }

  initDatabase();

  try {
    // Получаем все цитаты
    const quotes = await new Promise((resolve, reject) => {
      db.all('SELECT id, text, author, theme, source FROM quotes ORDER BY id', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    if (quotes.length === 0) {
      console.log('📚 Цитаты в базе данных не найдены.');
      process.exit(0);
    }

    console.log(`📚 Найдено ${quotes.length} цитат в базе данных.`);

    // Получаем статистику существующих объяснений
    const stats = await getExplanationStats();
    console.log(`✅ Уже есть объяснений: ${stats.quotes_with_explanations} из ${stats.total_quotes} (${stats.coverage_percentage}%)\n`);

    // Получаем цитаты без объяснений
    const quotesWithoutExplanations = await new Promise((resolve, reject) => {
      db.all(`
        SELECT q.id, q.text, q.author, q.theme, q.source 
        FROM quotes q 
        LEFT JOIN quote_explanations e ON q.id = e.quote_id 
        WHERE e.quote_id IS NULL 
        ORDER BY q.id
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    if (quotesWithoutExplanations.length === 0) {
      console.log('✅ Все цитаты уже имеют объяснения!');
      process.exit(0);
    }

    console.log(`🎯 Нужно создать объяснений: ${quotesWithoutExplanations.length}`);
    console.log('⏱️  Примерное время: ~' + Math.ceil(quotesWithoutExplanations.length * 10 / 60) + ' минут\n');

    let generated = 0;
    let errors = 0;

    for (const quote of quotesWithoutExplanations) {
      try {
        console.log(`🔄 Обрабатываю цитату #${quote.id}...`);
        
        const explanation = await generateQuoteExplanation(quote);
        
        if (explanation && !explanation.includes('Произошла ошибка') && !explanation.includes('не удалось создать')) {
          generated++;
          console.log(`✅ #${quote.id} - объяснение создано`);
        } else {
          errors++;
          console.log(`❌ #${quote.id} - ошибка генерации`);
        }

        // Пауза между запросами, чтобы не превысить лимиты API
        if (quotesWithoutExplanations.indexOf(quote) < quotesWithoutExplanations.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        errors++;
        console.error(`❌ #${quote.id} - ошибка:`, error.message);
      }
    }

    console.log('\n🎉 Генерация завершена!');
    console.log(`✅ Успешно создано: ${generated}`);
    console.log(`❌ Ошибок: ${errors}`);
    console.log(`📊 Общий прогресс: ${generated + stats.quotes_with_explanations} из ${quotes.length} цитат`);

  } catch (error) {
    console.error('💥 Критическая ошибка:', error);
  } finally {
    db.close();
  }
}

// Запускаем только если файл выполняется напрямую
if (require.main === module) {
  generateExplanationsForAllQuotes();
}

module.exports = { generateExplanationsForAllQuotes }; 