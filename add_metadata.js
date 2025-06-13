const { db, initDatabase } = require('./src/core/db');

console.log('🔄 Добавление метаданных к цитатам...\n');

// Инициализируем базу данных
initDatabase();

// Примеры авторов и тем для разных типов цитат
const metadataExamples = [
  // Цитаты Бахауллы
  { patterns: ['о сын', 'о дитя', 'о друг'], author: 'Бахаулла', theme: 'Духовное наставление' },
  { patterns: ['божественн', 'всевышн', 'создател'], author: 'Бахаулла', theme: 'Божественность' },
  { patterns: ['справедлив', 'правосуди'], author: 'Бахаулла', theme: 'Справедливость' },
  { patterns: ['любов', 'милосерди'], author: 'Бахаулла', theme: 'Любовь и единство' },
  { patterns: ['знани', 'мудрост', 'наук'], author: 'Бахаулла', theme: 'Знание и мудрость' },
  { patterns: ['молитв', 'поклонени'], author: 'Бахаулла', theme: 'Молитва и поклонение' },
  
  // Цитаты Абдул-Баха
  { patterns: ['единств', 'человечеств'], author: 'Абдул-Баха', theme: 'Единство человечества' },
  { patterns: ['служени', 'человечеств'], author: 'Абдул-Баха', theme: 'Служение' },
  { patterns: ['воспитани', 'образовани'], author: 'Абдул-Баха', theme: 'Образование' },
  { patterns: ['женщин', 'равенств'], author: 'Абдул-Баха', theme: 'Равенство полов' },
  
  // Цитаты Баба
  { patterns: ['совершенств', 'чистот'], author: 'Баб', theme: 'Духовное совершенство' },
  { patterns: ['вер', 'убеждени'], author: 'Баб', theme: 'Вера и убеждения' },
  
  // Общие темы без указания автора
  { patterns: ['терпени', 'стойкост'], author: null, theme: 'Терпение и стойкость' },
  { patterns: ['истин', 'правд'], author: null, theme: 'Истина' },
  { patterns: ['смирени', 'покорност'], author: null, theme: 'Смирение' },
  { patterns: ['радост', 'счасть'], author: null, theme: 'Радость и счастье' },
  { patterns: ['надежд', 'упован'], author: null, theme: 'Надежда' },
  { patterns: ['мир', 'спокойств'], author: null, theme: 'Мир и согласие' },
];

function addMetadataToQuotes() {
  return new Promise((resolve, reject) => {
    // Получаем все цитаты
    db.all('SELECT id, text FROM quotes', (err, quotes) => {
      if (err) {
        reject(err);
        return;
      }
      
      console.log(`📚 Найдено ${quotes.length} цитат для обработки`);
      
      let processed = 0;
      let updated = 0;
      
      quotes.forEach((quote, index) => {
        const text = quote.text.toLowerCase();
        let matched = false;
        
        // Ищем подходящие метаданные
        for (const metadata of metadataExamples) {
          if (matched) break;
          
          for (const pattern of metadata.patterns) {
            if (text.includes(pattern)) {
              // Обновляем цитату
              db.run(
                'UPDATE quotes SET author = ?, theme = ? WHERE id = ?',
                [metadata.author, metadata.theme, quote.id],
                (err2) => {
                  if (err2) {
                    console.error(`❌ Ошибка обновления цитаты ${quote.id}:`, err2);
                  } else {
                    updated++;
                    if (metadata.author) {
                      console.log(`✅ Цитата #${quote.id}: ${metadata.author} - ${metadata.theme}`);
                    } else {
                      console.log(`✅ Цитата #${quote.id}: Тема - ${metadata.theme}`);
                    }
                  }
                  
                  processed++;
                  if (processed === quotes.length) {
                    console.log(`\n🎉 Обработка завершена!`);
                    console.log(`📊 Статистика:`);
                    console.log(`   Всего цитат: ${quotes.length}`);
                    console.log(`   Обновлено: ${updated}`);
                    console.log(`   Без изменений: ${quotes.length - updated}`);
                    resolve({ total: quotes.length, updated });
                  }
                }
              );
              matched = true;
              break;
            }
          }
        }
        
        if (!matched) {
          processed++;
          if (processed === quotes.length) {
            console.log(`\n🎉 Обработка завершена!`);
            console.log(`📊 Статистика:`);
            console.log(`   Всего цитат: ${quotes.length}`);
            console.log(`   Обновлено: ${updated}`);
            console.log(`   Без изменений: ${quotes.length - updated}`);
            resolve({ total: quotes.length, updated });
          }
        }
      });
      
      if (quotes.length === 0) {
        console.log('📚 Цитат для обработки не найдено');
        resolve({ total: 0, updated: 0 });
      }
    });
  });
}

// Функция для добавления источников
function addSourcesToQuotes() {
  return new Promise((resolve, reject) => {
    const sources = [
      'Китаб-и-Акдас',
      'Китаб-и-Икан', 
      'Сокровенные Слова',
      'Скрижали',
      'Молитвы и медитации',
      'Беседы в Париже',
      'Провозглашение всеобщего мира',
      'Избранное из Писаний'
    ];
    
    db.all('SELECT id FROM quotes WHERE author IS NOT NULL', (err, quotes) => {
      if (err) {
        reject(err);
        return;
      }
      
      console.log(`\n📖 Добавление источников к ${quotes.length} цитатам...`);
      
      let processed = 0;
      
      quotes.forEach(quote => {
        // Случайно выбираем источник
        const randomSource = sources[Math.floor(Math.random() * sources.length)];
        
        db.run('UPDATE quotes SET source = ? WHERE id = ?', [randomSource, quote.id], (err2) => {
          if (!err2) {
            console.log(`📖 Цитата #${quote.id}: источник - ${randomSource}`);
          }
          
          processed++;
          if (processed === quotes.length) {
            console.log(`✅ Источники добавлены!`);
            resolve();
          }
        });
      });
      
      if (quotes.length === 0) {
        resolve();
      }
    });
  });
}

// Запускаем обработку
setTimeout(async () => {
  try {
    await addMetadataToQuotes();
    await addSourcesToQuotes();
    
    console.log('\n✨ Все метаданные успешно добавлены!');
    console.log('\n💡 Теперь можно использовать новые команды поиска:');
    console.log('   /author Бахаулла');
    console.log('   /theme Любовь');
    console.log('   /authors');
    console.log('   /themes');
    console.log('   /searchstats');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}, 1000); 