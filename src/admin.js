require('dotenv').config();

/*
 * Simple Admin Web Panel for Quote Bot
 * Uses basic HTTP auth; manage quotes and broadcasts.
 */

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const fs = require('fs');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const { version } = require('../package.json');

const setupNeeded = !process.env.BOT_TOKEN && process.env.NODE_ENV !== 'test';

let SQLiteStore, passport, isAuthenticated, sharedDb, initDatabase;
if (!setupNeeded) {
  SQLiteStore = require('connect-sqlite3')(session);
  ({ passport, isAuthenticated } = require('./core/auth'));
  ({ db: sharedDb, initDatabase } = require('./core/db'));
}

const quotesRouter = !setupNeeded ? require('./admin/routes/quotes') : null;
const broadcastsRouter = !setupNeeded ? require('./admin/routes/broadcasts') : null;
const usersRouter = !setupNeeded ? require('./admin/routes/users') : null;
const adminsRouter = !setupNeeded ? require('./admin/routes/admins') : null;
const authRouter = !setupNeeded ? require('./admin/routes/auth') : null;
const botRouter = !setupNeeded ? require('./admin/routes/bot') : null;
const setupRouter = require('./admin/routes/setup');

const PORT = Number(process.env.ADMIN_PORT || 3000);

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'admin/views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.static(path.join(__dirname, 'admin/public')));
app.use('/uploads/avatars', express.static(path.join(__dirname, 'admin/public/uploads/avatars')));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.locals.version = version;

// Ensure template variables exist even before authentication setup
app.use((req, res, next) => {
  res.locals.currentUser = null;
  res.locals.role = null;
  res.locals.profilePicture = null;
  next();
});

if (setupNeeded) {
  app.use('/', setupRouter);
  app.use((req, res) => res.redirect('/setup'));
  if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
      console.log(`[SETUP] Visit http://localhost:${PORT}/setup to configure the bot`);
    });
  }
} else {
  const avatarDirPath = path.join(__dirname, 'admin/public/uploads/avatars');
  if (!fs.existsSync(avatarDirPath)) {
    fs.mkdirSync(avatarDirPath, { recursive: true });
  }

  app.use(session({
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: '.'
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000
    }
  }));

  app.use(flash());
  app.use(passport.initialize());
  app.use(passport.session());

  app.use((req, res, next) => {
    res.locals.currentUser = req.user ? req.user.username : null;
    res.locals.role = req.user ? req.user.role : null;
    res.locals.profilePicture = req.user ? req.user.profile_picture : null;
    next();
  });

  app.use((req, res, next) => {
    if (req.user && req.user.role === 'guest' && req.method !== 'GET') {
      if (req.path === '/logout') return next();
      return res.status(403).send('Forbidden: read-only guest');
    }
    next();
  });

  app.use(isAuthenticated);

  if (!sharedDb._adminPatched) {
    sharedDb.close = () => {};
    sharedDb._adminPatched = true;
  }

  initDatabase();

  function db() {
    return sharedDb;
  }

  app.use('/quotes', quotesRouter);
  app.use('/broadcasts', broadcastsRouter);
  app.use('/users', usersRouter);
  app.use('/admins', adminsRouter);
  app.use('/', authRouter);
  app.use('/', botRouter);

  app.get('/', (req, res) => {
    const d = db();
    d.serialize(() => {
      d.get('SELECT COUNT(*) AS n FROM quotes', (e1, q) => {
        if (e1) return res.status(500).send(e1.message);
        d.get('SELECT COUNT(*) AS n FROM users', (e2, u) => {
          if (e2) return res.status(500).send(e2.message);
          d.get('SELECT COUNT(*) AS n FROM broadcasts', (e3, b) => {
            if (e3) return res.status(500).send(e3.message);
            res.render('dashboard', { title: 'Dashboard', quotes: q.n, users: u.n, broadcasts: b.n });
          });
        });
      });
    });
  });

  if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
      console.log(`[ADMIN] Panel running on http://localhost:${PORT}`);
    });
  }
}

module.exports = app;
