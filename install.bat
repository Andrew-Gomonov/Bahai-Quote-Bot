@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM Скрипт автоматической установки Bahai Quote Bot для Windows
REM Для людей без IT-знаний

echo.
echo 🕊️  Добро пожаловать в установщик Bahai Quote Bot для Windows
echo ====================================================
echo.

REM Проверка Node.js
echo Проверяем установку Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js не найден!
    echo.
    echo Пожалуйста, установите Node.js:
    echo 1. Перейдите на https://nodejs.org/
    echo 2. Скачайте LTS версию для Windows
    echo 3. Установите и перезапустите компьютер
    echo 4. Запустите этот скрипт снова
    echo.
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
    echo ✓ Node.js установлен: !NODE_VERSION!
)

echo.
echo 📱 Настройка Telegram бота
echo Для работы бота нужен токен от @BotFather в Telegram
echo.
echo Как получить токен:
echo 1. Напишите @BotFather в Telegram
echo 2. Отправьте команду /newbot
echo 3. Следуйте инструкциям и выберите имя бота
echo 4. Скопируйте полученный токен
echo.

:ask_token
set /p BOT_TOKEN="Введите токен бота: "
if "!BOT_TOKEN!"=="" (
    echo ❌ Токен не может быть пустым
    goto ask_token
)

echo.
echo 👤 Настройка администратора
echo Как узнать свой Telegram ID:
echo 1. Напишите @userinfobot в Telegram
echo 2. Отправьте команду /start
echo 3. Скопируйте ваш ID (только цифры)
echo.

:ask_admin
set /p ADMIN_ID="Введите ваш Telegram ID: "
if "!ADMIN_ID!"=="" (
    echo ❌ ID не может быть пустым
    goto ask_admin
)

echo.
echo 🌐 Веб-панель администратора
echo При первом запуске веб-панели вы сможете:
echo • Создать администратора с безопасным паролем
echo • Настроить токен бота (если не сделали этого сейчас)
echo • Получить доступ к полному управлению ботом
echo ✓ Веб-панель будет настроена при первом запуске

echo.
echo ⚙️ Создаём файл конфигурации...

REM Создание .env файла
(
echo # Токен Telegram бота (обязательно)
echo BOT_TOKEN=!BOT_TOKEN!
echo.
echo # Путь к базе данных SQLite
echo DB_PATH=bot.db
echo.
echo # Задержка между запросами цитат (в секундах)
echo COOLDOWN_SEC=30
echo.
echo # Порт для веб-панели администратора
echo ADMIN_PORT=3000
) > .env

echo ✓ Файл конфигурации .env создан

echo.
echo 📦 Устанавливаем зависимости...
npm install
if errorlevel 1 (
    echo ❌ Ошибка при установке зависимостей
    pause
    exit /b 1
)
echo ✓ Зависимости установлены

echo.
echo 📚 Импортируем цитаты...
if exist "data\bahai_quotes.json" (
    npm run import data/bahai_quotes.json
    echo ✓ Цитаты Bahá'í импортированы
)
if exist "data\rozy_lubvy.json" (
    npm run import data/rozy_lubvy.json
    echo ✓ Цитаты 'Розы Любви' импортированы
)

echo.
echo 👥 Добавляем Telegram администратора...
npm run add-admin !ADMIN_ID!
echo ✓ Telegram администратор добавлен

echo.
echo 📝 Создаём скрипты запуска...

REM Создание start_bot.bat
echo @echo off > start_bot.bat
echo chcp 65001 ^>nul >> start_bot.bat
echo echo 🕊️  Запуск Bahai Quote Bot >> start_bot.bat
echo if not exist ".env" goto no_env >> start_bot.bat
echo npm start >> start_bot.bat
echo pause >> start_bot.bat
echo goto end >> start_bot.bat
echo :no_env >> start_bot.bat
echo echo ❌ Файл .env не найден >> start_bot.bat
echo pause >> start_bot.bat
echo :end >> start_bot.bat

REM Создание start_web.bat
(
echo @echo off
echo chcp 65001 ^>nul
echo echo.
echo echo 🌐 Запуск веб-панели Bahai Quote Bot
echo echo ===================================
echo echo.
echo.
echo REM Проверяем .env файл
echo if not exist ".env" ^(
echo     echo ❌ Файл .env не найден. Запустите install.bat сначала
echo     pause
echo     exit /b 1
echo ^)
echo.
echo REM Проверяем Node.js
echo node --version ^>nul 2^>^&1
echo if errorlevel 1 ^(
echo     echo ❌ Node.js не найден. Установите Node.js
echo     pause
echo     exit /b 1
echo ^)
echo.
echo REM Получаем порт из .env
echo for /f "tokens=2 delims==" %%%%a in ^('findstr "^ADMIN_PORT=" .env 2^>nul'^) do set PORT=%%%%a
echo if "%%PORT%%"=="" set PORT=3000
echo.
echo REM Проверяем, занят ли порт
echo netstat -an ^| findstr ":%%PORT%% " ^>nul 2^>^&1
echo if not errorlevel 1 ^(
echo     echo ⚠️  Порт %%PORT%% уже используется!
echo     echo.
echo     echo 🔧 Решения:
echo     echo 1. Остановите приложение на порту %%PORT%%
echo     echo 2. Измените ADMIN_PORT в файле .env
echo     echo 3. Перезагрузите компьютер
echo     echo.
echo     set /p choice="Всё равно попробовать запустить? (y/N): "
echo     if /i not "%%choice%%"=="y" exit /b 0
echo ^)
echo.
echo echo ✓ Запускаем веб-панель...
echo echo Панель: http://localhost:%%PORT%%
echo echo Для остановки нажмите Ctrl+C
echo echo.
echo npm run admin-web
echo pause
) > start_web.bat

echo ✓ Скрипты запуска созданы

echo.
echo 🎉 Установка завершена успешно!
echo.
echo Что дальше:
echo 1. Запустите бота: дважды кликните start_bot.bat
echo 2. Запустите веб-панель: дважды кликните start_web.bat  
echo 3. Откройте в браузере: http://localhost:3000
echo 4. При первом входе на веб-панель создайте администратора
echo.
echo Удачи в использовании Bahai Quote Bot! 🕊️
echo.
pause 