#!/bin/bash

# Скрипт автоматической установки Bahai Quote Bot
# Для людей без IT-знаний

set -e  # Остановить выполнение при любой ошибке

# Цвета для красивого вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🕊️  Добро пожаловать в установщик Bahai Quote Bot${NC}"
echo -e "${BLUE}===================================================${NC}"
echo ""

# Функция для красивого вывода
print_step() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Проверка операционной системы
check_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        print_step "Операционная система: Linux"
        OS="linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        print_step "Операционная система: macOS"
        OS="macos"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
        print_step "Операционная система: Windows"
        OS="windows"
    else
        print_error "Неподдерживаемая операционная система: $OSTYPE"
        exit 1
    fi
}

# Установка Node.js
install_node() {
    print_info "Проверяем установку Node.js..."
    
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_step "Node.js уже установлен: $NODE_VERSION"
        
        # Проверяем версию (должна быть 16+)
        MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
        if [ "$MAJOR_VERSION" -ge 16 ]; then
            print_step "Версия Node.js подходит"
        else
            print_error "Требуется Node.js версии 16 или выше. Текущая: $NODE_VERSION"
            install_node_fresh
        fi
    else
        print_info "Node.js не найден. Устанавливаем..."
        install_node_fresh
    fi
}

install_node_fresh() {
    if [[ "$OS" == "linux" ]]; then
        print_info "Устанавливаем Node.js через NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif [[ "$OS" == "macos" ]]; then
        if command -v brew &> /dev/null; then
            print_info "Устанавливаем Node.js через Homebrew..."
            brew install node
        else
            print_error "Homebrew не найден. Установите Node.js вручную с https://nodejs.org/"
            exit 1
        fi
    else
        print_error "Автоматическая установка Node.js недоступна для Windows."
        print_info "Скачайте и установите Node.js с https://nodejs.org/"
        exit 1
    fi
    
    print_step "Node.js успешно установлен!"
}

# Функция для ввода токена бота
get_bot_token() {
    echo ""
    echo -e "${YELLOW}📱 Настройка Telegram бота${NC}"
    echo "Для работы бота нужен токен от @BotFather в Telegram"
    echo ""
    echo "Как получить токен:"
    echo "1. Напишите @BotFather в Telegram"
    echo "2. Отправьте команду /newbot"
    echo "3. Следуйте инструкциям и выберите имя бота"
    echo "4. Скопируйте полученный токен"
    echo ""
    
    while true; do
        read -p "Введите токен бота (например: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11): " BOT_TOKEN
        
        if [[ $BOT_TOKEN =~ ^[0-9]+:[a-zA-Z0-9_-]+$ ]]; then
            break
        else
            print_error "Неверный формат токена. Попробуйте ещё раз."
        fi
    done
    
    print_step "Токен бота сохранён"
}

# Функция для настройки админа
setup_admin() {
    echo ""
    echo -e "${YELLOW}👤 Настройка администратора${NC}"
    echo "Для управления ботом нужно настроить администратора"
    echo ""
    
    echo "Как узнать свой Telegram ID:"
    echo "1. Напишите @userinfobot в Telegram"
    echo "2. Отправьте команду /start"
    echo "3. Скопируйте ваш ID (только цифры)"
    echo ""
    
    while true; do
        read -p "Введите ваш Telegram ID (только цифры): " ADMIN_ID
        
        if [[ $ADMIN_ID =~ ^[0-9]+$ ]]; then
            break
        else
            print_error "ID должен содержать только цифры. Попробуйте ещё раз."
        fi
    done
    
    print_step "ID администратора сохранён: $ADMIN_ID"
}

# Информация о веб-панели
info_web_admin() {
    echo ""
    echo -e "${YELLOW}🌐 Веб-панель администратора${NC}"
    echo "При первом запуске веб-панели вы сможете:"
    echo "• Создать администратора с безопасным паролем"
    echo "• Настроить токен бота (если не сделали этого сейчас)"
    echo "• Получить доступ к полному управлению ботом"
    echo ""
    print_step "Веб-панель будет настроена при первом запуске"
}

# Создание файла конфигурации
create_env_file() {
    print_info "Создаём файл конфигурации..."
    
    cat > .env << EOF
# Токен Telegram бота (обязательно)
BOT_TOKEN=$BOT_TOKEN

# Путь к базе данных SQLite
DB_PATH=bot.db

# Задержка между запросами цитат (в секундах)
COOLDOWN_SEC=30

# Порт для веб-панели администратора
ADMIN_PORT=3000

# Дополнительные настройки (необязательно)
# OPENAI_API_KEY=sk-...     # OpenAI API ключ для GPT рассылок
# OPENAI_MODEL=gpt-4-turbo  # Модель OpenAI
# OPENAI_MAX_TOKENS=200     # Максимум токенов для GPT
EOF
    
    print_step "Файл конфигурации .env создан"
}

# Установка зависимостей
install_dependencies() {
    print_info "Устанавливаем зависимости проекта..."
    npm install
    print_step "Зависимости установлены"
}

# Импорт цитат
import_quotes() {
    print_info "Импортируем цитаты в базу данных..."
    
    if [ -f "data/bahai_quotes.json" ]; then
        npm run import data/bahai_quotes.json
        print_step "Цитаты Bahá'í импортированы"
    fi
    
    if [ -f "data/rozy_lubvy.json" ]; then
        npm run import data/rozy_lubvy.json
        print_step "Цитаты 'Розы Любви' импортированы"
    fi
}

# Добавление Telegram администратора
add_telegram_admin() {
    print_info "Добавляем Telegram администратора..."
    
    # Добавляем Telegram админа
    npm run add-admin $ADMIN_ID
    print_step "Telegram администратор добавлен"
}

# Создание скрипта запуска
create_start_script() {
    print_info "Создаём скрипт запуска..."
    
    cat > start_bot.sh << 'EOF'
#!/bin/bash

# Скрипт запуска Bahai Quote Bot

# Цвета для вывода
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🕊️  Запуск Bahai Quote Bot${NC}"
echo -e "${BLUE}=========================${NC}"

# Проверяем наличие .env файла
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ Файл .env не найден. Запустите install.sh сначала${NC}"
    exit 1
fi

# Запускаем бота
echo -e "${GREEN}✓ Запускаем Telegram бота...${NC}"
echo "Для остановки нажмите Ctrl+C"
echo ""

npm start
EOF
    
    chmod +x start_bot.sh
    print_step "Скрипт запуска создан (start_bot.sh)"
}

# Создание скрипта для веб-панели
create_web_script() {
    print_info "Создаём скрипт для веб-панели..."
    
     cat > start_web.sh << 'EOF'
 #!/bin/bash
 
 # Скрипт запуска веб-панели Bahai Quote Bot
 
 # Цвета для вывода
 GREEN='\033[0;32m'
 BLUE='\033[0;34m'
 RED='\033[0;31m'
 YELLOW='\033[0;33m'
 NC='\033[0m'
 
 echo -e "${BLUE}🌐 Запуск веб-панели Bahai Quote Bot${NC}"
 echo -e "${BLUE}===================================${NC}"
 
 # Проверяем наличие .env файла
 if [ ! -f ".env" ]; then
     echo -e "${RED}❌ Файл .env не найден. Запустите install.sh сначала${NC}"
     exit 1
 fi
 
 # Проверяем Node.js
 if ! command -v node &> /dev/null; then
     echo -e "${RED}❌ Node.js не найден. Установите Node.js и попробуйте снова${NC}"
     exit 1
 fi
 
 # Получаем порт из .env файла
 PORT=$(grep '^ADMIN_PORT=' .env 2>/dev/null | cut -d'=' -f2 || echo "3000")
 
 # Проверяем, занят ли порт
 if lsof -i :$PORT >/dev/null 2>&1; then
     echo -e "${YELLOW}⚠️  Порт $PORT уже используется!${NC}"
     echo ""
     echo "🔧 Решения:"
     echo "1. Остановите приложение на порту $PORT"
     echo "2. Измените ADMIN_PORT в файле .env"
     echo "3. Найдите процесс: lsof -i :$PORT"
     echo ""
     read -p "Всё равно попробовать запустить? (y/N): " choice
     if [[ ! "$choice" =~ ^[Yy]$ ]]; then
         echo "Отменено пользователем"
         exit 0
     fi
 fi
 
 # Запускаем веб-панель
 echo -e "${GREEN}✓ Запускаем веб-панель...${NC}"
 echo "Панель будет доступна по адресу: http://localhost:$PORT"
 echo "Для остановки нажмите Ctrl+C"
 echo ""
 
 npm run admin-web
 EOF
    
    chmod +x start_web.sh
    print_step "Скрипт веб-панели создан (start_web.sh)"
}

# Создание README для пользователя
create_user_readme() {
    print_info "Создаём инструкцию для пользователя..."
    
    cat > ИНСТРУКЦИЯ.md << EOF
# 🕊️ Bahai Quote Bot - Инструкция по использованию

## 🚀 Как запустить бота

### Telegram бот
\`\`\`bash
./start_bot.sh
\`\`\`

### Веб-панель администратора
\`\`\`bash
./start_web.sh
\`\`\`
Затем откройте в браузере: http://localhost:3000

## 👥 Команды для пользователей

- \`/start\` - подписаться на ежедневные цитаты
- \`/stop\` - отписаться от всех уведомлений
- \`/quote\` - получить случайную цитату
- \`/time 09:30\` - установить время получения ежедневных цитат
- \`/find текст\` - найти цитаты по тексту
- \`/help\` - показать справку

## 🔧 Команды для администраторов

- \`/push 2024-12-25 10:00 С Рождеством!\` - отправить сообщение в указанное время
- \`/weekly 1 09:00 Доброе утро понедельника!\` - еженедельная рассылка (1=понедельник)
- \`/blist\` - список запланированных рассылок
- \`/bdel ID\` - удалить рассылку

 ## 🛠️ Полезные команды
 
 ### Добавить нового Telegram администратора
 \`\`\`bash
 npm run add-admin TELEGRAM_ID
 \`\`\`
 
 ### Добавить веб-администратора
 Используйте веб-панель: Администраторы → Добавить нового

### Импортировать новые цитаты
\`\`\`bash
npm run import путь/к/файлу.json
\`\`\`

## 📁 Важные файлы

- \`.env\` - настройки бота (токен, порт и т.д.)
- \`bot.db\` - база данных с цитатами и пользователями
- \`start_bot.sh\` - запуск Telegram бота
- \`start_web.sh\` - запуск веб-панели

## 🆘 В случае проблем

1. Убедитесь что токен бота правильный
2. Проверьте что файл \`.env\` существует
3. Перезапустите бота: остановите (Ctrl+C) и запустите снова
4. Проверьте что порт 3000 свободен для веб-панели

## 📞 Контакты

По вопросам обращайтесь к: andrei.gomonov.md@gmail.com
EOF
    
    print_step "Инструкция создана (ИНСТРУКЦИЯ.md)"
}

# Основная функция установки
main() {
    echo -e "${BLUE}Начинаем автоматическую установку...${NC}"
    echo ""
    
    # Проверяем ОС
    check_os
    
    # Устанавливаем Node.js
    install_node
    
    # Получаем настройки от пользователя
    get_bot_token
    setup_admin
    info_web_admin
    
    # Настраиваем проект
    create_env_file
    install_dependencies
    import_quotes
    add_telegram_admin
    
    # Создаём скрипты и документацию
    create_start_script
    create_web_script
    create_user_readme
    
    echo ""
    echo -e "${GREEN}🎉 Установка завершена успешно!${NC}"
    echo ""
    echo -e "${YELLOW}Что дальше:${NC}"
    echo "1. Запустите Telegram бота: ./start_bot.sh"
    echo "2. Запустите веб-панель: ./start_web.sh"
    echo "3. Откройте веб-панель в браузере: http://localhost:3000"
    echo "4. При первом входе на веб-панель создайте администратора"
    echo "5. Прочитайте ИНСТРУКЦИЯ.md для подробной информации"
    echo ""
    echo -e "${GREEN}Удачи в использовании Bahai Quote Bot! 🕊️${NC}"
}

# Запускаем установку
main 