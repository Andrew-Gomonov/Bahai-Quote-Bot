const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const bcrypt = require('bcrypt');
const { db: sharedDb } = require('../../core/db');

function db() { return sharedDb; }

// Avatar upload configuration (reuse same directory as auth route)
const avatarDir = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = file.fieldname + '-' + Date.now() + ext;
    cb(null, safeName);
  }
});

function fileFilter(req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/gif'];
  if (allowed.includes(file.mimetype)) cb(null, true); else cb(new Error('Invalid file type'));
}

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter });

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
    d.all('SELECT username, role, profile_picture FROM web_admins ORDER BY username', (e2, webRows) => {
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
router.post('/web-update/:old', requireSuper, upload.single('profile_picture'), (req, res) => {
  const old = req.params.old;
  const { username: newUser, password, role } = req.body;
  if (!newUser) return res.redirect('/admins');
  const newRole = ['admin', 'guest', 'super'].includes(role) ? role : 'admin';
  const d = db();

  // Fetch current profile picture to possibly delete later
  d.get('SELECT profile_picture FROM web_admins WHERE username = ?', [old], (selErr, row) => {
    if (selErr) return res.status(500).send(selErr.message);

    const currentPic = row ? row.profile_picture : null;

    const finish = (hash) => {
      const queryParts = ['username = ?', 'role = ?'];
      const params = [newUser, newRole];

      if (hash) {
        queryParts.push('password = ?');
        params.push(hash);
      }

      if (req.file) {
        const relPath = '/uploads/avatars/' + req.file.filename;
        queryParts.push('profile_picture = ?');
        params.push(relPath);

        // Remove old picture if exists and different
        if (currentPic && currentPic !== relPath) {
          const oldPath = path.join(__dirname, '..', 'public', currentPic);
          if (fs.existsSync(oldPath)) fs.unlink(oldPath, () => {});
        }
      }

      params.push(old); // WHERE username = ?
      const sql = `UPDATE web_admins SET ${queryParts.join(', ')} WHERE username = ?`;
      d.run(sql, params, () => res.redirect('/admins'));
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