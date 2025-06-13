#!/usr/bin/env node
/*
 * setup-git.js
 * Кроссплатформенный (Node.js) вариант скрипта инициализации git-репозитория
 * и публикации его на GitHub через gh CLI.
 *
 * Использование:
 *   node scripts/setup-git.js  [repoName]  [public|private]  [description]
 * 
 * Перед запуском убедись, что:
 *   1. git установлен и доступен в PATH
 *   2. GitHub CLI (gh) установлен и выполнялась `gh auth login`
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

function checkCli(binary) {
  try {
    execSync(`${binary} --version`, { stdio: 'ignore' });
  } catch {
    console.error(`${binary} не найден в PATH. Установи его и попробуй снова.`);
    process.exit(1);
  }
}

// ---------------- Аргументы ----------------
const repoName = process.argv[2] || path.basename(process.cwd());
const visibilityArg = (process.argv[3] || 'public').toLowerCase();
const visibility = visibilityArg === 'private' ? 'private' : 'public';
const description = process.argv.slice(4).join(' ') || 'Auto-created repository';

// ---------------- Проверки CLI -------------
checkCli('git');
checkCli('gh');

// ---------------- Git init -----------------
if (!fs.existsSync(path.join(process.cwd(), '.git'))) {
  console.log('[INFO] Инициализируем локальный git-репозиторий');
  exec('git init -b main');
}

// ---------------- .gitignore ---------------
const gitignorePath = path.join(process.cwd(), '.gitignore');
if (!fs.existsSync(gitignorePath)) {
  console.log('[INFO] Добавляю .gitignore (Node)');
  fs.writeFileSync(
    gitignorePath,
    'node_modules/\n.env\nuploads/\n.DS_Store\n*.log\n',
    'utf8'
  );
  exec('git add .gitignore');
}

// ---------------- First commit -------------
try {
  execSync('git rev-parse --verify HEAD', { stdio: 'ignore' });
} catch {
  console.log('[INFO] Первый commit');
  exec('git add .');
  exec('git commit -m "Initial commit"');
}

// ---------------- Remote origin ------------
let hasOrigin = false;
try {
  const remotes = execSync('git remote', { encoding: 'utf8' });
  hasOrigin = remotes.split(/\r?\n/).includes('origin');
} catch {}

if (!hasOrigin) {
  console.log(`[INFO] Создаём репозиторий на GitHub: ${repoName} (${visibility})`);
  exec(
    `gh repo create "${repoName}" --${visibility} --description "${description}" --source . --remote origin --push`
  );
} else {
  console.log('[INFO] origin уже настроен, пушим изменения');
  exec('git push -u origin main');
}

console.log(`[DONE] Репозиторий ${repoName} синхронизирован с GitHub`); 