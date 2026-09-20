'use strict';

const express = require('express');

const prisma = require('../config/prisma');
const config = require('../config');
const sec = require('../utils/security');
const audit = require('../services/audit.service');
const mailer = require('../services/mailer.service');
const { authLimiter } = require('../middleware/rateLimit');
const { redirectIfAuthed, loadUser } = require('../middleware/auth');
const { DISTRICTS } = require('../config/constants');

const router = express.Router();

// ---------------------------------------------------------------
// GET /login
// ---------------------------------------------------------------
router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('auth/login', {
    title: 'Sign in',
    layout: 'layouts/auth',
    bodyClass: 'auth-page',
    metaTitle: 'Sign in — WooHelperPro',
  });
});

// ---------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------
router.post('/login', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const remember = req.body.remember === 'on';
  const render = (error) =>
    res.status(401).render('auth/login', {
      title: 'Sign in',
      layout: 'layouts/auth',
      bodyClass: 'auth-page',
      metaTitle: 'Sign in — WooHelperPro',
      error,
      // The view reads these as flat locals (`email`, `remember`), so pass them
      // flat. A nested `values: { email }` used to be sent here and the view
      // never read it -- which silently dropped the typed address on any failed
      // sign-in attempt.
      email,
      remember,
      returnTo: String(req.body.returnTo || ''),
    });

  if (!email || !password) return render('Enter your email and password.');

  const user = await prisma.user.findUnique({ where: { email } });

  // Uniform failure message: do not reveal whether the email exists.
  if (!user) return render('Incorrect email or password.');

  if (user.status === 'SUSPENDED') {
    return render('This account is suspended. Please contact support.');
  }
  if (user.status === 'INACTIVE') {
    return render('This account is inactive. Please contact support.');
  }

  const ok = await sec.compare(password, user.passwordHash);
  if (!ok) {
    await audit.log(req, 'auth.login_failed', { entityType: 'User', entityId: user.id, userId: user.id });
    return render('Incorrect email or password.');
  }

  // Regenerate the session ID on privilege change to prevent session fixation.
  req.session.regenerate((err) => {
    if (err) return render('Could not start your session. Please try again.');

    req.session.userId = user.id;
    req.session.role = user.role;
    if (remember) req.session.cookie.maxAge = config.session.maxAge;

    prisma.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), lastLoginIp: audit.clientIp(req) },
      })
      .catch(() => {});

    req.session.save(async () => {
      await audit.log(req, 'auth.login', { entityType: 'User', entityId: user.id, userId: user.id });

      const returnTo = req.session.returnTo;
      delete req.session.returnTo;

      if (returnTo && !returnTo.startsWith('/login')) return res.redirect(returnTo);
      return res.redirect(user.role === 'CUSTOMER' ? '/account' : '/admin');
    });
  });
});

// ---------------------------------------------------------------
// GET /register
// ---------------------------------------------------------------
router.get('/register', redirectIfAuthed, (req, res) => {
  res.render('auth/register', {
    title: 'Create your account',
    layout: 'layouts/auth',
    bodyClass: 'auth-page',
    metaTitle: 'Create a free account — WooHelperPro',
    districts: DISTRICTS,
  });
});

// ---------------------------------------------------------------
// POST /register
// ---------------------------------------------------------------
router.post('/register', authLimiter, async (req, res) => {
  const {
    name = '', email = '', phone = '', password = '', confirmPassword = '',
    company = '', district = '', address = '', packageId = '',
  } = req.body;

  const values = { name, email, phone, company, district, address };
  const render = (error) =>
    res.status(400).render('auth/register', {
      title: 'Create your account',
      layout: 'layouts/auth',
      bodyClass: 'auth-page',
      metaTitle: 'Create a free account — WooHelperPro',
      districts: DISTRICTS,
      error,
      values,
    });

  const cleanName = String(name).trim();
  const cleanEmail = String(email).trim().toLowerCase();

  const errors = [];
  if (cleanName.length < 2) errors.push('Please enter your full name.');
  if (!sec.isValidEmail(cleanEmail)) errors.push('Please enter a valid email address.');

  const normalizedPhone = sec.normalizeBdPhone(phone);
  if (!normalizedPhone) errors.push('Enter a valid Bangladeshi mobile number, e.g. 01712345678.');

  const pw = sec.validatePassword(password);
  if (!pw.valid) errors.push(...pw.errors);
  if (password !== confirmPassword) errors.push('The two passwords do not match.');
  if (req.body.terms !== 'on') errors.push('Please accept the terms of service to continue.');

  if (errors.length) return render(errors.join(' '));

  const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (existing) return render('An account with this email already exists. Try signing in instead.');

  const passwordHash = await sec.hash(password);

  const user = await prisma.user.create({
    data: {
      name: cleanName,
      email: cleanEmail,
      phone: normalizedPhone,
      passwordHash,
      company: String(company).trim() || null,
      district: String(district).trim() || null,
      address: String(address).trim() || null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerified: false,
    },
  });

  await audit.log(req, 'auth.register', {
    entityType: 'User',
    entityId: user.id,
    userId: user.id,
    detail: `${user.email} registered`,
  });

  mailer.send({ to: user.email, ...mailer.templates.welcome(user) }).catch(() => {});

  // Signing the user straight in removes a friction step in checkout.
  req.session.regenerate((err) => {
    if (err) {
      req.flash('success', 'Account created. Please sign in.');
      return res.redirect('/login');
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.save(() => {
      req.flash('success', `Welcome to WooHelperPro, ${user.name.split(' ')[0]}!`);
      // If they arrived from a package page, send them back to finish ordering.
      const target = packageId ? `/order/checkout?package=${packageId}` : '/account';
      return res.redirect(target);
    });
  });
});

// ---------------------------------------------------------------
// POST /logout
// ---------------------------------------------------------------
router.post('/logout', loadUser, async (req, res) => {
  if (req.user) {
    await audit.log(req, 'auth.logout', { entityType: 'User', entityId: req.user.id, userId: req.user.id });
  }
  req.session.destroy(() => {
    res.clearCookie(config.session.name);
    res.redirect('/');
  });
});

// ---------------------------------------------------------------
// Language + theme toggles (small UX affordances, session-scoped)
// ---------------------------------------------------------------
router.get('/lang/:code', (req, res) => {
  const code = req.params.code === 'bn' ? 'bn' : 'en';
  req.session.lang = code;
  req.session.save(() => res.redirect(req.get('referer') || '/'));
});

router.get('/theme/:name', (req, res) => {
  req.session.theme = req.params.name === 'dark' ? 'dark' : 'light';
  req.session.save(() => res.redirect(req.get('referer') || '/'));
});

// ---------------------------------------------------------------
// Forgot password — records a request for the support team to action.
// Deliberately does not disclose whether the email exists.
// ---------------------------------------------------------------
router.get('/forgot-password', redirectIfAuthed, (req, res) => {
  res.render('auth/forgot-password', {
    title: 'Reset your password',
    layout: 'layouts/auth',
    bodyClass: 'auth-page',
    metaTitle: 'Reset your password — WooHelperPro',
  });
});

router.post('/forgot-password', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } }).catch(() => null);

  if (user) {
    await audit.log(req, 'auth.password_reset_requested', {
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
    });

    // Support team gets notified; the customer gets a ticket opened on their behalf.
    await prisma.ticket
      .create({
        data: {
          ticketNumber: `WHP-TCK-${Date.now().toString(36).toUpperCase()}`,
          userId: user.id,
          subject: 'Password reset requested',
          message: `A password reset was requested from ${audit.clientIp(req)}. Please verify the customer's identity and issue a temporary password.`,
          category: 'GENERAL',
          priority: 'HIGH',
          status: 'OPEN',
        },
      })
      .catch(() => {});
  }

  res.render('auth/forgot-password', {
    title: 'Reset your password',
    layout: 'layouts/auth',
    bodyClass: 'auth-page',
    metaTitle: 'Reset your password — WooHelperPro',
    sent: true,
  });
});

module.exports = router;
