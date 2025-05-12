#!/usr/bin/env node
/*
 * git-manager.js
 * Скрипт для управления git-репозиторием и версионированием
 * 
 * Использование:
 *   node scripts/git-manager.js version [major|minor|patch]  # Обновить версию
 *   node scripts/git-manager.js push                         # Закоммитить и запушить изменения
 *   node scripts/git-manager.js status                       # Показать статус
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function exec(cmd, opts = {}) {
  try {
    return execSync(cmd, { stdio: 'inherit', ...opts });
  } catch (e) {
    console.error(`[ERROR] Команда вышла с ошибкой: ${cmd}`);
    process.exit(e.status || 1);
  }
}

function getCurrentVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    return packageJson.version;
  } catch (e) {
    console.error('[ERROR] Не могу прочитать версию из package.json');
    process.exit(1);
  }
}

function updateVersion(type) {
  const currentVersion = getCurrentVersion();
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  
  let newVersion;
  switch (type) {
    case 'major':
      newVersion = `${major + 1}.0.0`;
      break;
    case 'minor':
      newVersion = `${major}.${minor + 1}.0`;
      break;
    case 'patch':
      newVersion = `${major}.${minor}.${patch + 1}`;
      break;
    default:
      console.error('[ERROR] Неверный тип версии. Используй: major, minor или patch');
      process.exit(1);
  }

  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  packageJson.version = newVersion;
  fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
  
  console.log(`[INFO] Версия обновлена: ${currentVersion} -> ${newVersion}`);
  return newVersion;
}

function commitAndPush(version) {
  const commitMessage = `v${version}`;
  
  console.log('[INFO] Коммитим изменения...');
  exec('git add .');
  exec(`git commit -m "${commitMessage}"`);
  
  console.log('[INFO] Создаем тег...');
  exec(`git tag -a "v${version}" -m "${commitMessage}"`);
  
  console.log('[INFO] Пушим изменения...');
  exec('git push origin main --tags');
}

function showStatus() {
  console.log('[INFO] Статус репозитория:');
  exec('git status');
  console.log('\n[INFO] Последние коммиты:');
  exec('git log --oneline -n 5');
}

// ---------------- Main ----------------
const command = process.argv[2];

switch (command) {
  case 'version':
    const type = process.argv[3];
    if (!type) {
      console.error('[ERROR] Укажи тип версии: major, minor или patch');
      process.exit(1);
    }
    const newVersion = updateVersion(type);
    commitAndPush(newVersion);
    break;
    
  case 'push':
    const currentVersion = getCurrentVersion();
    commitAndPush(currentVersion);
    break;
    
  case 'status':
    showStatus();
    break;
    
  default:
    console.error(`
[ERROR] Неизвестная команда: ${command}

Использование:
  node scripts/git-manager.js version [major|minor|patch]  # Обновить версию
  node scripts/git-manager.js push                         # Закоммитить и запушить изменения
  node scripts/git-manager.js status                       # Показать статус
    `);
    process.exit(1);
} 