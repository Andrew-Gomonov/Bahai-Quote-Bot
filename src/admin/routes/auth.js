const express = require('express');
const router = express.Router();

const { passport } = require('../../core/auth');

// Login page
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  // `flash` middleware already in app; get first error message
  res.render('login', { title: 'Вход', error: req.flash('error')[0] });
});

// Login POST
router.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login',
  failureFlash: true
}));

// Logout
router.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/login');
  });
});

module.exports = router; 