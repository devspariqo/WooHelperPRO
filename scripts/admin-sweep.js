'use strict';

/**
 * Exhaustive admin-panel route sweep.
 *
 * Every GET route in src/routes/admin/*.routes.js is exercised against the RUNNING
 * server with real record IDs pulled from the database. A route is only counted as
 * working if it returns the status the route intends -- a 200, or the documented
 * redirect. A 500 is always a failure; a 404 on a page that should exist is too.
 *
 * Usage:  node scripts/admin-sweep.js [baseUrl]
 * Needs the server running and the database seeded.
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const prisma = require(path.join(ROOT, 'src/config/prisma'));

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@woohelperpro.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'WooHelper@2026';

// ---------------------------------------------------------------------------
// HTTP helpers -- a minimal cookie jar, enough for one session.
// ---------------------------------------------------------------------------
let COOKIE = '';

function storeCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const pair = c.split(';')[0];
    const [name] = pair.split('=');
    const existing = COOKIE.split('; ').filter((p) => p && !p.startsWith(`${name}=`));
    existing.push(pair);
    COOKIE = existing.join('; ');
  }
}

async function req(method, url, body) {
  const headers = {};
  if (COOKIE) headers.cookie = COOKIE;
  let payload;
  if (body) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body).toString();
  }
  const res = await fetch(`${BASE}${url}`, { method, headers, body: payload, redirect: 'manual' });
  storeCookies(res);
  return res;
}

async function csrfToken() {
  const res = await req('GET', '/login');
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]*)"/);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
// Real IDs from the database, so no route is tested against a fake record.
// ---------------------------------------------------------------------------
async function ids() {
  const [user, service, pkg, order, sub, invoice, payment, ticket, lead, coupon,
    project, milestone, testimonial, portfolio, post, faq, category] = await Promise.all([
    prisma.user.findFirst({ where: { role: 'CUSTOMER' } }),
    prisma.service.findFirst(),
    prisma.package.findFirst(),
    prisma.order.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.subscription.findFirst(),
    prisma.invoice.findFirst(),
    prisma.payment.findFirst(),
    prisma.ticket.findFirst(),
    prisma.lead.findFirst(),
    prisma.coupon.findFirst(),
    prisma.project.findFirst(),
    prisma.projectMilestone.findFirst(),
    prisma.testimonial.findFirst(),
    prisma.portfolioItem.findFirst(),
    prisma.blogPost.findFirst(),
    prisma.faq.findFirst(),
    prisma.serviceCategory.findFirst(),
  ]);
  return { user, service, pkg, order, sub, invoice, payment, ticket, lead, coupon,
    project, milestone, testimonial, portfolio, post, faq, category };
}

// ---------------------------------------------------------------------------
// The full GET route table, with the status each route should return.
// ---------------------------------------------------------------------------
function routes(i) {
  const r = [];
  const add = (url, want, note) => r.push({ url, want: want || 200, note: note || '' });

  // dashboard.routes.js  (mounted at /)
  add('/admin');
  add('/admin/reports');
  add('/admin/activity');

  // users.routes.js
  add('/admin/users');
  add('/admin/users/new');
  if (i.user) {
    add(`/admin/users/${i.user.id}`, 200, 'user detail');
    add(`/admin/users/${i.user.id}/edit`, 200, 'user edit');
  }

  // services.routes.js
  add('/admin/services');
  add('/admin/services/categories');
  add('/admin/services/new');
  if (i.service) {
    add(`/admin/services/${i.service.id}`, 200, 'service detail');
    add(`/admin/services/${i.service.id}/edit`, 200, 'service edit');
  }

  // packages.routes.js
  add('/admin/packages');
  add('/admin/packages/new');
  if (i.pkg) add(`/admin/packages/${i.pkg.id}/edit`, 200, 'package edit');

  // orders.routes.js
  add('/admin/orders');
  if (i.order) add(`/admin/orders/${i.order.id}`, 200, 'order detail');

  // subscriptions.routes.js
  add('/admin/subscriptions');
  add('/admin/subscriptions/new');
  if (i.sub) add(`/admin/subscriptions/${i.sub.id}`, 200, 'subscription detail');

  // billing.routes.js
  add('/admin/invoices');
  add('/admin/payments');
  if (i.invoice) add(`/admin/invoices/${i.invoice.id}`, 200, 'invoice detail');

  // crm.routes.js
  add('/admin/tickets');
  if (i.ticket) add(`/admin/tickets/${i.ticket.id}`, 200, 'ticket detail');
  add('/admin/leads');
  add('/admin/coupons');
  add('/admin/projects');

  // content.routes.js
  add('/admin/testimonials');
  add('/admin/portfolio');
  add('/admin/blog');
  add('/admin/blog/new');
  if (i.post) add(`/admin/blog/${i.post.id}/edit`, 200, 'blog edit');
  add('/admin/faqs');
  add('/admin/settings');
  add('/admin/media');

  return r;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
(async () => {
  console.log(`\nWooHelperPro admin sweep  ->  ${BASE}\n`);

  const token = await csrfToken();
  const login = await req('POST', '/login', {
    _csrf: token, email: ADMIN_EMAIL, password: ADMIN_PASSWORD,
  });
  const loc = login.headers.get('location');
  console.log(`login: ${login.status} -> ${loc}`);
  if (login.status !== 302 || loc !== '/admin') {
    console.log('FATAL: could not sign in as admin. Is the database seeded?');
    process.exit(1);
  }

  const i = await ids();
  const missing = Object.entries(i).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) console.log(`note: no seeded row for: ${missing.join(', ')}\n`);

  const list = routes(i);
  const fails = [];
  const seen = new Map();

  for (const { url, want, note } of list) {
    let status;
    let detail = '';
    try {
      const res = await req('GET', url);
      status = res.status;
      if (status >= 400) {
        const body = await res.text();
        // Pull the template error out of the dev error page, if present.
        const m = body.match(/<code>([^<]{0,180})<\/code>/);
        const t = body.match(/<title>([^<]*)<\/title>/);
        detail = m ? m[1] : (t ? t[1] : '');
      }
    } catch (err) {
      status = 'ERR';
      detail = err.message;
    }

    const ok = status === want;
    const label = `${status}`.padEnd(4);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} ${url}${note ? `   (${note})` : ''}${detail ? `\n        ${detail}` : ''}`);
    if (!ok) fails.push({ url, want, status, detail });
    seen.set(status, (seen.get(status) || 0) + 1);
  }

  console.log('\n' + '='.repeat(58));
  console.log(`total : ${list.length}`);
  console.log('status breakdown: ' + [...seen.entries()].map(([k, v]) => `${k}=${v}`).join('  '));
  if (fails.length) {
    console.log(`\nFAILURES (${fails.length}):`);
    for (const f of fails) console.log(`  ${f.status} (want ${f.want}) ${f.url}\n      ${f.detail}`);
  } else {
    console.log('\nAll admin GET routes returned their intended status.');
  }

  await prisma.$disconnect();
  process.exit(fails.length ? 1 : 0);
})();
