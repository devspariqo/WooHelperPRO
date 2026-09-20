'use strict';

const crypto = require('crypto');

/**
 * CSRF protection using the synchroniser-token pattern, implemented directly
 * so it does not depend on the deprecated `csurf` package (which is no longer
 * maintained and breaks on current Express).
 *
 * Token = HMAC(sessionId + secret). Stable for the life of the session, so it
 * survives multi-tab use and form re-renders without spurious failures.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Paths that receive machine-to-machine POSTs and therefore cannot carry a
// browser session token. Webhooks verify authenticity by signature instead.
const EXEMPT_PATHS = [
  '/payments/webhook/sslcommerz',
  '/payments/webhook/bkash',
  '/api/health',
];

function tokenFor(req) {
  const secret = req.app.get('csrfSecret');
  const sid = req.sessionID || '';
  return crypto.createHmac('sha256', secret).update(sid).digest('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function csrf(req, res, next) {
  // One token per session; reuse it so parallel tabs don't invalidate each other.
  if (!req.session.csrfSecret) req.session.csrfSecret = crypto.randomBytes(32).toString('hex');
  const token = tokenFor(req);

  res.locals.csrfToken = token;
  res.locals.csrfField = `<input type="hidden" name="_csrf" value="${token}">`;

  if (SAFE_METHODS.has(req.method)) return next();
  if (EXEMPT_PATHS.some((p) => req.path.startsWith(p))) return next();

  const supplied =
    req.body?._csrf ||
    req.query?._csrf ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token');

  if (!supplied) {
    return res.status(403).render('errors/403', {
      title: 'Security check failed',
      message: 'Your form session expired. Please go back, refresh the page and try again.',
    });
  }

  if (!timingSafeEqual(supplied, token)) {
    return res.status(403).render('errors/403', {
      title: 'Security check failed',
      message: 'This request could not be verified. Please refresh the page and try again.',
    });
  }

  return next();
}

module.exports = { csrf, tokenFor };
