const fs = require('fs');
const path = require('path');

class EnvManager {
  constructor() {
    this.envPath = path.join(__dirname, '..', '..', '.env');
    this.envCache = {};
    this.lastModified = 0;
  }

  // Парсинг .env файла
  parseEnvFile(content) {
    const vars = {};
    if (!content) return vars;

    content.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          vars[key.trim()] = valueParts.join('=').trim();
        }
      }
    });
    return vars;
  }

  // Чтение текущих переменных из .env файла
  readEnvFile() {
    try {
      if (!fs.existsSync(this.envPath)) {
        return {};
      }

      const stats = fs.statSync(this.envPath);
      const currentModified = stats.mtime.getTime();

      // Если файл не изменился, возвращаем из кеша
      if (currentModified === this.lastModified) {
        return this.envCache;
      }

      const content = fs.readFileSync(this.envPath, 'utf8');
      this.envCache = this.parseEnvFile(content);
      this.lastModified = currentModified;

      return this.envCache;
    } catch (error) {
      console.error('[ENV] Error reading .env file:', error);
      return {};
    }
  }

  // Получение значения переменной (сначала из файла, потом из process.env)
  get(key, defaultValue = '') {
    const envVars = this.readEnvFile();
    return envVars[key] || process.env[key] || defaultValue;
  }

  // Получение всех переменных
  getAll() {
    const envVars = this.readEnvFile();
    
    // Объединяем переменные из файла и process.env
    return {
      ...process.env,
      ...envVars
    };
  }

  // Обновление переменной в .env файле
  set(key, value) {
    try {
      let envContent = '';
      if (fs.existsSync(this.envPath)) {
        envContent = fs.readFileSync(this.envPath, 'utf8');
      }

      const lines = envContent.split(/\r?\n/);
      let updated = false;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(key + '=')) {
          lines[i] = `${key}=${value}`;
          updated = true;
          break;
        }
      }

      if (!updated) {
        lines.push(`${key}=${value}`);
      }

      // Записываем обновленный файл
      fs.writeFileSync(this.envPath, lines.filter(line => line.trim() !== '').join('\n'));
      
      // Обновляем process.env
      process.env[key] = value;
      
      // Сбрасываем кеш
      this.lastModified = 0;
      
      console.log(`[ENV] Updated ${key} in .env file`);
      return true;
    } catch (error) {
      console.error(`[ENV] Error updating ${key}:`, error);
      return false;
    }
  }

  // Обновление нескольких переменных
  setMultiple(vars) {
    const results = {};
    for (const [key, value] of Object.entries(vars)) {
      results[key] = this.set(key, value);
    }
    return results;
  }

  // Создание .env файла с базовыми настройками
  createDefault(botToken = '') {
    const defaultVars = {
      'BOT_TOKEN': botToken || 'YOUR_BOT_TOKEN_HERE',
      'DB_PATH': 'bot.db',
      'COOLDOWN_SEC': '30',
      'ADMIN_PORT': '3000',
      'SESSION_SECRET': this.generateRandomSecret(),
      'OPENAI_API_KEY': '# sk-...',
      'OPENAI_API_BASE_URL': 'https://api.llm7.io/v1',
      'OPENAI_MODEL': 'gpt-4.1-nano',
      'OPENAI_MAX_TOKENS': '200'
    };

    const content = [
      '# Telegram Bot Configuration',
      '# Получите токен бота у @BotFather в Telegram',
      `BOT_TOKEN=${defaultVars.BOT_TOKEN}`,
      '',
      '# Database Configuration', 
      `DB_PATH=${defaultVars.DB_PATH}`,
      '',
      '# Bot Settings',
      `COOLDOWN_SEC=${defaultVars.COOLDOWN_SEC}`,
      '',
      '# Admin Panel Configuration',
      `ADMIN_PORT=${defaultVars.ADMIN_PORT}`,
      `SESSION_SECRET=${defaultVars.SESSION_SECRET}`,
      '',
      '# OpenAI Configuration (optional)',
      `OPENAI_API_KEY=${defaultVars.OPENAI_API_KEY}`,
      `OPENAI_API_BASE_URL=${defaultVars.OPENAI_API_BASE_URL}`,
      `OPENAI_MODEL=${defaultVars.OPENAI_MODEL}`,
      `OPENAI_MAX_TOKENS=${defaultVars.OPENAI_MAX_TOKENS}`,
      ''
    ].join('\n');

    try {
      fs.writeFileSync(this.envPath, content, 'utf8');
      console.log('[ENV] Created default .env file');
      return true;
    } catch (error) {
      console.error('[ENV] Error creating .env file:', error);
      return false;
    }
  }

  generateRandomSecret() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let result = '';
    for (let i = 0; i < 64; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Проверка существования файла .env
  exists() {
    return fs.existsSync(this.envPath);
  }

  // Получение пути к .env файлу
  getPath() {
    return this.envPath;
  }
}

// Создаем единственный экземпляр
const envManager = new EnvManager();

module.exports = envManager; 