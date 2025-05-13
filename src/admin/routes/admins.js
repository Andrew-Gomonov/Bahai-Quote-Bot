const express = require('express');
const router = express.Router();

const bcrypt = require('bcrypt');
const { db: sharedDb } = require('../../core/db');

function db() { return sharedDb; }

// Middleware: only super admins allowed
function requireSuper(req, res, next) {
  if (req.user && req.user.role === 'super') return next();
  return res.status(403).send('Forbidden');
}

// List admins page
router.get('/', (req, res) => {
  const d = db();
  d.all('SELECT chat_id FROM admins WHERE chat_id IS NOT NULL ORDER BY chat_id', (err, tgRows) => {
    if (err) return res.status(500).send(err.message);
    d.all('SELECT username, role FROM web_admins ORDER BY username', (e2, webRows) => {
      if (e2) return res.status(500).send(e2.message);
      res.render('admins', {
        title: 'Админы',
        tgAdmins: tgRows,
        webAdmins: webRows,
        isSuper: req.user?.role === 'super'
      });
    });
  });
});

// Add TG admin
router.post('/', (req, res) => {
  const id = Number(req.body.chat_id);
  if (!id) return res.redirect('/admins');
  const d = db();
  d.run('INSERT OR IGNORE INTO admins(chat_id) VALUES (?)', [id], () => {
    res.redirect('/admins');
  });
});

// Delete TG admin
router.post('/delete/:id', (req, res) => {
  const id = Number(req.params.id);
  const d = db();
  d.run('DELETE FROM admins WHERE chat_id = ?', [id], () => {
    res.redirect('/admins');
  });
});

// Add / replace web admin (requires super)
router.post('/web', requireSuper, (req, res) => {
  const { username, password, role } = req.body;
  if (!(username && password)) return res.redirect('/admins');
  const r = ['super', 'admin', 'guest'].includes(role) ? role : 'admin';
  bcrypt.hash(password, 10, (err, hash) => {
    if (err) return res.status(500).send(err.message);
    const d = db();
    d.run('INSERT OR REPLACE INTO web_admins(username, password, role) VALUES (?, ?, ?)', [username, hash, r], () => {
      res.redirect('/admins');
    });
  });
});

// Update existing web admin (requires super)
router.post('/web-update/:old', requireSuper, (req, res) => {
  const old = req.params.old;
  const { username: newUser, password, role } = req.body;
  if (!newUser) return res.redirect('/admins');
  const newRole = ['admin', 'guest', 'super'].includes(role) ? role : 'admin';
  const d = db();

  const finish = (hash) => {
    if (hash) {
      d.run('UPDATE web_admins SET username = ?, role = ?, password = ? WHERE username = ?', [newUser, newRole, hash, old], () => res.redirect('/admins'));
    } else {
      d.run('UPDATE web_admins SET username = ?, role = ? WHERE username = ?', [newUser, newRole, old], () => res.redirect('/admins'));
    }
  };

  if (password) {
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) return res.status(500).send(err.message);
      finish(hash);
    });
  } else {
    finish();
  }
});

// Delete web admin (requires super)
router.post('/delete-web/:username', requireSuper, (req, res) => {
  const username = req.params.username;
  const d = db();
  d.run('DELETE FROM web_admins WHERE username = ?', [username], () => {
    res.redirect('/admins');
  });
});

module.exports = router; 