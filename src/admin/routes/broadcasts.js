const express = require('express');
const router = express.Router();

const { DateTime } = require('luxon');
const { db: sharedDb, DEFAULT_TZ } = require('../../core/db');
const { gptGenerate } = require('../../bot/gpt');

// Helper to access shared sqlite instance
function db() {
  return sharedDb;
}

// ================= MARKUP HELPERS =================
function pushModalMarkup() {
  return `
<div class="modal fade" id="newPushModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-lg">
    <div class="modal-content">
      <form method="POST" action="/broadcasts/push">
        <div class="modal-header"><h5 class="modal-title"><i class="bi bi-send-plus-fill me-2"></i>Новая PUSH рассылка</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="row g-2 mb-3">
            <div class="col-md-6"><label class="form-label"><i class="bi bi-calendar-date me-1"></i>Дата</label><input type="date" name="date" class="form-control" required></div>
            <div class="col-md-6"><label class="form-label"><i class="bi bi-clock me-1"></i>Время</label><input type="time" name="time" class="form-control" required></div>
          </div>
          <div class="mb-3">
            <label class="form-label"><i class="bi bi-chat-left-text me-1"></i>Сообщение</label>
            <textarea name="message" class="form-control" rows="4" placeholder="Оставьте пустым, если хотите сгенерировать через ChatGPT (см. ниже)"></textarea>
          </div>
          <div class="form-check mb-2">
            <input class="form-check-input" type="checkbox" value="1" id="pushUseGpt" name="use_gpt">
            <label class="form-check-label" for="pushUseGpt"><i class="bi bi-robot me-1"></i>Сгенерировать текст через ChatGPT</label>
          </div>
          <div class="mb-3">
            <label class="form-label"><i class="bi bi-card-text me-1"></i>Промпт для ChatGPT (опционально)</label>
            <textarea name="gpt_prompt" class="form-control" rows="3" placeholder="Если пусто, используется промпт по умолчанию..."></textarea>
          </div>
          <div>
            <label class="form-label"><i class="bi bi-image me-1"></i>Ссылка/ID картинки (опционально)</label>
            <input type="text" name="image" class="form-control" placeholder="URL изображения или Telegram File ID" />
          </div>
        </div>
        <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button><button type="submit" class="btn btn-primary"><i class="bi bi-plus-circle-fill me-1"></i>Добавить</button></div>
      </form>
    </div>
  </div>
</div>`;
}

function weeklyModalMarkup() {
  return `
<div class="modal fade" id="newWeeklyModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-lg">
    <div class="modal-content">
      <form method="POST" action="/broadcasts/weekly">
        <div class="modal-header"><h5 class="modal-title"><i class="bi bi-calendar-week-fill me-2"></i>Новая Weekly рассылка</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="row g-2 mb-3">
            <div class="col-md-6">
              <label class="form-label"><i class="bi bi-calendar-day me-1"></i>День недели</label>
              <select name="day" class="form-select">
                <option value="1">Понедельник</option><option value="2">Вторник</option><option value="3">Среда</option><option value="4">Четверг</option><option value="5">Пятница</option><option value="6">Суббота</option><option value="7">Воскресенье</option>
              </select>
            </div>
            <div class="col-md-6"><label class="form-label"><i class="bi bi-clock me-1"></i>Время</label><input type="time" name="time" class="form-control" required></div>
          </div>
          <div class="mb-3">
            <label class="form-label"><i class="bi bi-chat-left-text me-1"></i>Сообщение</label>
            <textarea name="message" class="form-control" rows="4" placeholder="Оставьте пустым, если хотите сгенерировать через ChatGPT (см. ниже)"></textarea>
          </div>
          <div class="form-check mb-2">
            <input class="form-check-input" type="checkbox" value="1" id="weeklyUseGpt" name="use_gpt">
            <label class="form-check-label" for="weeklyUseGpt"><i class="bi bi-robot me-1"></i>Сгенерировать текст через ChatGPT (каждую неделю будет новый)</label>
          </div>
          <div class="mb-3">
            <label class="form-label"><i class="bi bi-card-text me-1"></i>Промпт для ChatGPT (опционально)</label>
            <textarea name="gpt_prompt" class="form-control" rows="3" placeholder="Если пусто, используется промпт по умолчанию..."></textarea>
          </div>
          <div>
            <label class="form-label"><i class="bi bi-image me-1"></i>Ссылка/ID картинки (опционально)</label>
            <input type="text" name="image" class="form-control" placeholder="URL изображения или Telegram File ID" />
          </div>
        </div>
        <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button><button type="submit" class="btn btn-primary"><i class="bi bi-plus-circle-fill me-1"></i>Добавить</button></div>
      </form>
    </div>
  </div>
</div>`;
}

function dailyModalMarkup() {
  return `
<div class="modal fade" id="newDailyModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-lg">
    <div class="modal-content">
      <form method="POST" action="/broadcasts/daily">
        <div class="modal-header"><h5 class="modal-title"><i class="bi bi-calendar-day-fill me-2"></i>Новая Daily рассылка</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="row g-2 mb-3">
            <div class="col"><label class="form-label"><i class="bi bi-clock me-1"></i>Время</label><input type="time" name="time" class="form-control" required></div>
          </div>
          <div class="mb-3">
            <label class="form-label"><i class="bi bi-chat-left-text me-1"></i>Сообщение</label>
            <textarea name="message" class="form-control" rows="4" placeholder="Оставьте пустым, если хотите сгенерировать через ChatGPT (см. ниже)"></textarea>
          </div>
          <div class="form-check mb-2">
            <input class="form-check-input" type="checkbox" value="1" id="dailyUseGpt" name="use_gpt">
            <label class="form-check-label" for="dailyUseGpt"><i class="bi bi-robot me-1"></i>Сгенерировать текст через ChatGPT (каждый день будет новый)</label>
          </div>
          <div class="mb-3">
            <label class="form-label"><i class="bi bi-card-text me-1"></i>Промпт для ChatGPT (опционально)</label>
            <textarea name="gpt_prompt" class="form-control" rows="3" placeholder="Если пусто, используется промпт по умолчанию..."></textarea>
          </div>
          <div>
            <label class="form-label"><i class="bi bi-image me-1"></i>Ссылка/ID картинки (опционально)</label>
            <input type="text" name="image" class="form-control" placeholder="URL изображения или Telegram File ID" />
          </div>
        </div>
        <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button><button type="submit" class="btn btn-primary"><i class="bi bi-plus-circle-fill me-1"></i>Добавить</button></div>
      </form>
    </div>
  </div>
</div>`;
}

function imgModalMarkup() {
  return `
<div class="modal fade" id="imgModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog">
    <div class="modal-content">
      <form method="POST" id="imgForm" action="">
        <div class="modal-header"><h5 class="modal-title"><i class="bi bi-image-fill me-2"></i>Изображение рассылки</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <label class="form-label">URL или FileID изображения</label>
          <div class="input-group mb-3">
            <input type="text" name="image" class="form-control" placeholder="Вставьте URL или Telegram File ID" />
            <a id="imgOpen" class="btn btn-outline-secondary" href="#" target="_blank" style="display:none;" title="Открыть изображение в новой вкладке"><i class="bi bi-box-arrow-up-right"></i></a>
          </div>
          <small class="form-text text-muted">Оставьте поле пустым и нажмите "Сохранить", чтобы удалить текущее изображение (если оно было).</small>
        </div>
        <div class="modal-footer justify-content-between">
          <button type="submit" name="remove" value="1" class="btn btn-outline-danger" title="Удалить изображение из этой рассылки"><i class="bi bi-trash-fill me-1"></i>Удалить картинку</button>
          <div>
            <button type="button" class="btn btn-secondary me-2" data-bs-dismiss="modal">Отмена</button>
            <button type="submit" class="btn btn-primary"><i class="bi bi-save-fill me-1"></i>Сохранить</button>
          </div>
        </div>
      </form>
    </div>
  </div>
</div>`;
}

// ================= ROUTES =================
// List broadcasts
router.get('/', (req, res) => {
  const d = db();
  d.all('SELECT * FROM broadcasts ORDER BY (type="weekly") DESC, id DESC LIMIT 100', (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.render('broadcasts', {
      title: 'Рассылки',
      rows,
      pushModal: pushModalMarkup(),
      weeklyModal: weeklyModalMarkup(),
      dailyModal: dailyModalMarkup(),
      imgModal: imgModalMarkup()
    });
  });
});

// Add PUSH broadcast
router.post('/push', async (req, res) => {
  const { date, time, message, image, use_gpt, gpt_prompt } = req.body;
  if (!(date && time && (message || use_gpt))) return res.redirect('/broadcasts');

  const useGpt = use_gpt ? 1 : 0;
  const prompt = (gpt_prompt || '').trim() || 'Сгенерируй вдохновляющий пост для Telegram на основе цитат Баха\'и (до 400 символов)';

  let finalMsg = message;
  if (useGpt) {
    try {
      finalMsg = await gptGenerate(prompt);
    } catch (e) {
      console.error('[ADMIN] GPT error:', e);
      finalMsg = '(GPT error)';
    }
  }
  const localDt = DateTime.fromISO(`${date}T${time}`, { zone: DEFAULT_TZ });
  const iso = localDt.isValid ? localDt.toUTC().toISO() : `${date}T${time}:00Z`;
  const d = db();
  d.run('INSERT INTO broadcasts(type, schedule, message, image, use_gpt, gpt_prompt) VALUES ("push", ?, ?, ?, ?, ?)', [iso, finalMsg, image || null, useGpt, prompt], () => {
    res.redirect('/broadcasts');
  });
});

// Add WEEKLY broadcast
router.post('/weekly', async (req, res) => {
  const { day, time, message, image, use_gpt, gpt_prompt } = req.body;
  if (!(day && time && (message || use_gpt))) return res.redirect('/broadcasts');

  const useGpt = use_gpt ? 1 : 0;
  const prompt = (gpt_prompt || '').trim() || 'Сгенерируй вдохновляющий пост для Telegram на основе цитат Баха\'и (до 400 символов)';

  let finalMsg = message;
  if (useGpt) {
    try {
      finalMsg = await gptGenerate(prompt);
    } catch (e) {
      console.error('[ADMIN] GPT error:', e);
      finalMsg = '(GPT error)';
    }
  }
  const sched = `${day}|${time}`;
  const d = db();
  d.run('INSERT INTO broadcasts(type, schedule, message, image, use_gpt, gpt_prompt) VALUES ("weekly", ?, ?, ?, ?, ?)', [sched, finalMsg, image || null, useGpt, prompt], () => {
    res.redirect('/broadcasts');
  });
});

// Add DAILY broadcast
router.post('/daily', async (req, res) => {
  const { time, message, image, use_gpt, gpt_prompt } = req.body;
  if (!(time && (message || use_gpt))) return res.redirect('/broadcasts');

  const useGpt = use_gpt ? 1 : 0;
  const prompt = (gpt_prompt || '').trim() || 'Сгенерируй вдохновляющий пост для Telegram на основе цитат Баха\'i (до 400 символов)';

  let finalMsg = message;
  if (useGpt) {
    try {
      finalMsg = await gptGenerate(prompt);
    } catch (e) {
      console.error('[ADMIN] GPT error:', e);
      finalMsg = '(GPT error)';
    }
  }
  const d = db();
  d.run('INSERT INTO broadcasts(type, schedule, message, image, use_gpt, gpt_prompt) VALUES ("daily", ?, ?, ?, ?, ?)', [time, finalMsg, image || null, useGpt, prompt], () => {
    res.redirect('/broadcasts');
  });
});

// Update broadcast image
router.post('/update-image/:id', (req, res) => {
  const id = Number(req.params.id);
  let img = (req.body.image || '').trim();
  if (req.body.remove) img = null;
  const d = db();
  d.run('UPDATE broadcasts SET image = ? WHERE id = ?', [img || null, id], () => {
    res.redirect('/broadcasts');
  });
});

// Edit broadcast message
router.post('/edit/:id', (req, res) => {
  const id = Number(req.params.id);
  const message = (req.body.message || '').trim();
  if (!message) return res.redirect('/broadcasts');
  const d = db();
  d.run('UPDATE broadcasts SET message = ? WHERE id = ?', [message, id], () => {
    res.redirect('/broadcasts');
  });
});

// Delete broadcast
router.post('/delete/:id', (req, res) => {
  const id = Number(req.params.id);
  const d = db();
  d.run('DELETE FROM broadcasts WHERE id = ?', [id], () => {
    res.redirect('/broadcasts');
  });
});

module.exports = router; 