const express = require('express');
const router = express.Router();

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DateTime } = require('luxon');

const envPath = path.join(__dirname, '..', '.env');

let botProcess = null;

function botStatus() {
  if (!botProcess) return 'stopped';
  return botProcess.killed ? 'stopped' : 'running';
}

function startBot() {
  if (botProcess) return false;
  botProcess = spawn('node', ['src/index.js'], { stdio: 'inherit' });
  botProcess.on('exit', () => {
    botProcess = null;
  });
  return true;
}

function stopBot(force = false) {
  if (!botProcess) return false;
  try {
    botProcess.kill(force ? 'SIGKILL' : 'SIGINT');
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

// Bot dashboard
router.get('/bot', (req, res) => {
  res.render('bot', {
    title: 'Бот',
    status: botStatus(),
    pid: botProcess ? botProcess.pid : null,
    currentToken: process.env.BOT_TOKEN || '',
    openaiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
    openaiMaxTokens: process.env.OPENAI_MAX_TOKENS || 200
  });
});

router.post('/bot/start', (req, res) => {
  startBot();
  res.redirect('/bot');
});

router.post('/bot/stop', (req, res) => {
  stopBot(false);
  res.redirect('/bot');
});

router.post('/bot/kill', (req, res) => {
  stopBot(true);
  res.redirect('/bot');
});

router.post('/bot/restart', (req, res) => {
  stopBot(false);
  setTimeout(startBot, 500);
  res.redirect('/bot');
});

// Update bot token in .env
router.post('/bot/update-token', (req, res) => {
  const newToken = (req.body.token || '').trim();
  if (!newToken) return res.redirect('/bot');

  let envContent = '';
  if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf8');

  const lines = envContent.split(/\r?\n/).filter(Boolean);
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('BOT_TOKEN=')) {
      lines[i] = `BOT_TOKEN=${newToken}`;
      found = true;
      break;
    }
  }
  if (!found) lines.push(`BOT_TOKEN=${newToken}`);

  fs.writeFileSync(envPath, lines.join('\n'));
  process.env.BOT_TOKEN = newToken;
  console.log('[ADMIN] BOT_TOKEN updated');
  res.redirect('/bot');
});

function updateEnvVar(key, value) {
  let envContent = '';
  if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split(/\r?\n/);
  let updated = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(key + '=')) {
      lines[i] = `${key}=${value}`;
      updated = true;
      break;
    }
  }
  if (!updated) lines.push(`${key}=${value}`);
  fs.writeFileSync(envPath, lines.filter(Boolean).join('\n'));
  process.env[key] = value;
}

// Update GPT settings
router.post('/gpt/update', (req, res) => {
  const { api_key, model, max_tokens } = req.body;
  if (api_key) updateEnvVar('OPENAI_API_KEY', api_key.trim());
  if (model) updateEnvVar('OPENAI_MODEL', model.trim());
  if (max_tokens) updateEnvVar('OPENAI_MAX_TOKENS', String(max_tokens).trim());
  console.log('[ADMIN] OpenAI settings updated');
  res.redirect('/bot');
});

// Stop admin panel itself
router.post('/panel/stop', (req, res) => {
  res.send('Панель выключается...');
  console.log('[ADMIN] Panel shutting down by user request');
  setTimeout(() => process.exit(0), 500);
});

module.exports = router; 