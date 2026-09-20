'use strict';

const rateLimit = require('express-rate-limit');

/** Shared JSON/HTML handler: browsers get a rendered page, fetch() gets JSON. */
function handler(message, status = 429) {
  return (req, res) => {
    const wantsJson =
      req.xhr ||
      req.path.startsWith('/api/') ||
      (req.get('accept') || '').includes('application/json');
    if (wantsJson) {
      return res.status(status).json({ ok: false, error: message });
    }
    return res.status(status).render('errors/429', { title: 'Too many requests', message });
  };
}

const standard = {
  standardHeaders: true,
  legacyHeaders: false,
};

/** Broad protection for the whole site. */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  ...standard,
  handler: handler('Too many requests from this network. Please slow down and try again shortly.'),
});

/** Login/register/forgot-password — brute-force surface. */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  skipSuccessfulRequests: true,
  ...standard,
  handler: handler('Too many sign-in attempts. Please wait 15 minutes before trying again.'),
});

/** Public lead/contact/order forms — spam surface. */
const formLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  ...standard,
  handler: handler('You have submitted this form too many times. Please try again in an hour.'),
});

/** Payment submission — prevent card/wallet testing abuse. */
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  ...standard,
  handler: handler('Too many payment attempts. Please wait a few minutes.'),
});

module.exports = { globalLimiter, authLimiter, formLimiter, paymentLimiter };
