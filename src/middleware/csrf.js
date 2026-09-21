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

/**
 * Error pages are rendered from middleware that runs BEFORE loadUser, so they
 * must not inherit the app's default layout.
 *
 * `app.set('layout', 'layouts/public')` is the default, and `layouts/public.ejs`
 * includes `partials/navbar`, which reads `isAuthenticated` and `isStaff`. Those
 * are assigned by `loadUser` -- which runs after `csrf`, `rateLimit`,
 * `requireRole` and `requireStaff`. Rendering any error page through the public
 * layout therefore threw `isAuthenticated is not defined`, turning a clean 403
 * (or 429, or 404) into a 500.
 *
 * Note that a view CANNOT opt out by assigning `layout` in its own template:
 * express-ejs-layouts resolves the layout name from
 * `options.layout || res.locals.layout || app.get('layout')` *before* the view
 * body is rendered, so an in-template assignment is read too late and silently
 * ignored. It has to come through `res.render` options or `res.locals`.
 *
 * Sending it as a render option is the only approach that works for every call
 * site -- the 19 `res.status(4xx).render('errors/…')` calls scattered across
 * middleware, route files and guards.
 */
const ERROR_PAGE_LAYOUT = { layout: 'layouts/error' };

const ERROR_VIEW = /^errors\//;

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

/**
 * Re-points `res.render` at the dependency-free error layout for any `errors/*`
 * view. Wrapped in a marker so repeated calls never stack wrappers.
 */
function useErrorLayout(res) {
  if (res.__errorLayoutWrapped) return;
  res.__errorLayoutWrapped = true;

  const original = res.render;

  res.render = function render(view, options, fn) {
    if (typeof view !== 'string' || !ERROR_VIEW.test(view)) {
      return original.call(this, view, options, fn);
    }

    // res.render(view, cb)
    if (typeof options === 'function') {
      return original.call(this, view, { ...ERROR_PAGE_LAYOUT }, options);
    }

    // res.render(view, { … }) -- caller options win, but the layout is forced
    // unless the caller deliberately supplied one.
    const merged = { ...ERROR_PAGE_LAYOUT, ...(options || {}) };

    if (typeof fn === 'function') return original.call(this, view, merged, fn);
    return original.call(this, view, merged);
  };
}

function csrf(req, res, next) {
  useErrorLayout(res);

  // A missing session is a failure mode, not a crash.
  //
  // express-session leaves `req.session` undefined when it has no valid cookie to
  // work from -- which happens whenever the client never returns one: the browser
  // is blocking the cookie, the `Secure` cookie was set on an HTTPS origin and the
  // request came back over HTTP, or a proxy stripped it. Before this guard the next
  // line threw `TypeError: Cannot read properties of undefined (reading
  // 'csrfSecret')`, a plain TypeError with no `.status`, so the error handler
  // reported it as a 500. That made every POST a 500 -- including sign-in -- which
  // is indistinguishable from the form being broken, and buried the real cause.
  //
  // Without a session there is no token to compare against, so the honest answer
  // for a state-changing request is 403. Safe methods have nothing to verify and
  // are let through so the page can still render.
  if (!req.session) {
    if (SAFE_METHODS.has(req.method)) return next();
    return res.status(403).render('errors/403', {
      title: 'Security check failed',
      message:
        'Your browser did not send the session cookie, so this form could not be verified. ' +
        'Enable cookies for this site (or sign in again) and retry.',
    });
  }

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

module.exports = { csrf, tokenFor, useErrorLayout };
