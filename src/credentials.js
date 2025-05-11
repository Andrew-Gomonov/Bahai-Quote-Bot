const fs = require('fs');
const path = require('path');
const os = require('os');

const envPath = path.join(__dirname, '..', '.env');

class CredentialsManager {
  constructor() {
    this.envPath = envPath;
  }

  validateNewPassword(newPassword, confirmNewPassword) {
    if (!newPassword) return { valid: true };
    
    if (newPassword !== confirmNewPassword) {
      return { 
        valid: false, 
        error: 'Новый пароль и его подтверждение не совпадают.' 
      };
    }
    
    if (newPassword.length < 6) {
      return { 
        valid: false, 
        error: 'Новый пароль должен быть не менее 6 символов.' 
      };
    }

    return { valid: true };
  }

  updateCredentials(currentPassword, newUsername, newPassword) {
    try {
      let envContent = '';
      if (fs.existsSync(this.envPath)) {
        envContent = fs.readFileSync(this.envPath, 'utf8');
      }
      
      const lines = envContent.split(/\r?\n/);
      let foundAdminUser = false;
      let foundAdminPass = false;

      const newLines = lines.map(line => {
        if (line.startsWith('ADMIN_USER=')) {
          foundAdminUser = true;
          return `ADMIN_USER=${newUsername}`;
        }
        if (line.startsWith('ADMIN_PASSWORD=')) {
          foundAdminPass = true;
          return newPassword ? `ADMIN_PASSWORD=${newPassword}` : line;
        }
        return line;
      });

      if (!foundAdminUser) {
        newLines.push(`ADMIN_USER=${newUsername}`);
      }
      if (newPassword && !foundAdminPass) {
        newLines.push(`ADMIN_PASSWORD=${newPassword}`);
      }
      
      // Удаляем пустые строки в конце
      while (newLines.length > 0 && newLines[newLines.length - 1].trim() === '') {
        newLines.pop();
      }

      fs.writeFileSync(this.envPath, newLines.join(os.EOL) + os.EOL);
      
      return {
        success: true,
        message: `Учетные данные успешно обновлены в файле .env. ADMIN_USER установлен как "${newUsername}". Пароль ${newPassword ? 'обновлен' : 'не изменен'}.`
      };
    } catch (err) {
      console.error('Ошибка при обновлении .env файла:', err);
      return {
        success: false,
        error: 'Произошла ошибка при сохранении изменений. Проверьте логи сервера.'
      };
    }
  }
}

module.exports = new CredentialsManager(); 