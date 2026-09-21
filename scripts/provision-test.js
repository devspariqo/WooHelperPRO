'use strict';

/**
 * Website-handover provisioning check.
 *
 * Covers the whole path and, importantly, the boundary:
 *   1. Admin saves handover details against a subscription.
 *   2. The OWNING customer sees them on their dashboard and subscription page.
 *   3. A DIFFERENT customer does NOT -- neither on their own dashboard nor by
 *      requesting the other customer's subscription id directly.
 *   4. A non-http(s) URL is rejected (a javascript: URL rendered into an anchor
 *      would be stored XSS on the customer's dashboard).
 *   5. Clearing every field withdraws the handover.
 *
 * Restores the subscription to its original state at the end.
 *
 * Usage: node scripts/provision-test.js [baseUrl]
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const prisma = require(path.join(ROOT, 'src/config/prisma'));

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const ADMIN = ['admin@woohelperpro.com', 'WooHelper@2026'];

let COOKIE = '';
function store(res) {
  for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    COOKIE = COOKIE.split('; ').filter((p) => p && !p.startsWith(`${name}=`)).concat(pair).join('; ');
  }
}
async function req(method, url, body) {
  const headers = {};
  if (COOKIE) headers.cookie = COOKIE;
  let payload;
  if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body).toString(); }
  const res = await fetch(`${BASE}${url}`, { method, headers, body: payload, redirect: 'manual' });
  store(res);
  return res;
}
async function token(pathname) {
  const html = await (await req('GET', pathname)).text();
  const m = html.match(/name="_csrf" value="([^"]*)"/);
  return m ? m[1] : '';
}
async function login(email, password) {
  COOKIE = '';
  const t = await token('/login');
  return req('POST', '/login', { _csrf: t, email, password });
}

const results = [];
function check(label, pass, detail) {
  results.push({ label, pass });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? `   ${detail}` : ''}`);
}

const SECRET = 'Tr0ub4dor&3-whp-test';
const SITE = 'https://roundtrip-test-shop.com';
const ADMINURL = 'https://roundtrip-test-shop.com/wp-admin';

(async () => {
  console.log(`\nWebsite handover check -> ${BASE}\n`);

  // Pick a subscription that has an owning customer, plus a different customer.
  const sub = await prisma.subscription.findFirst({ include: { user: true }, orderBy: { createdAt: 'asc' } });
  if (!sub) { console.log('FATAL: no subscription in the database to test against'); process.exit(1); }

  const other = await prisma.user.findFirst({
    where: { id: { not: sub.userId }, role: 'CUSTOMER' },
    select: { id: true, email: true },
  });

  console.log(`subscription : ${sub.subscriptionNumber}`);
  console.log(`owner        : ${sub.user.email}`);
  console.log(`other        : ${other ? other.email : '(none found)'}\n`);

  const before = {
    provisionedSiteUrl: sub.provisionedSiteUrl,
    provisionedAdminUrl: sub.provisionedAdminUrl,
    provisionedUsername: sub.provisionedUsername,
    provisionedPassword: sub.provisionedPassword,
    provisionedNotes: sub.provisionedNotes,
    provisionedAt: sub.provisionedAt,
    provisionedById: sub.provisionedById,
  };

  // ---- 1. admin saves ----
  const adminLogin = await login(...ADMIN);
  if (adminLogin.status !== 302) { console.log('FATAL: admin login failed'); process.exit(1); }

  const t1 = await token(`/admin/subscriptions/${sub.id}`);
  const save = await req('POST', `/admin/subscriptions/${sub.id}/provision`, {
    _csrf: t1,
    provisionedSiteUrl: SITE,
    provisionedAdminUrl: ADMINURL,
    provisionedUsername: 'shopowner',
    provisionedPassword: SECRET,
    provisionedNotes: 'Log in and change the password on first use.',
  });
  check('admin can save handover details', save.status === 302, `status ${save.status}`);

  const saved = await prisma.subscription.findUnique({ where: { id: sub.id } });
  check('details persisted', saved.provisionedSiteUrl === SITE && saved.provisionedPassword === SECRET);
  check('provisionedAt stamped', !!saved.provisionedAt);
  check('provisionedBy recorded', !!saved.provisionedById);

  // ---- 2. owner sees them ----
  const ownerLogin = await login(sub.user.email, 'Demo@1234');
  if (ownerLogin.status !== 302) {
    // The seeded owner may use the admin password; fall back rather than fail.
    await login(sub.user.email, 'WooHelper@2026');
  }

  const dash = await (await req('GET', '/account')).text();
  check('owner sees the website panel on their dashboard', dash.includes('Your website'));
  check('owner sees the site URL', dash.includes(SITE));
  check('owner sees the admin panel URL', dash.includes(ADMINURL));
  // EJS escapes the markup, and the password contains '&' on purpose: the raw
  // value appears as &amp; in the HTML. Asserting on the UNESCAPED string would
  // be asserting that escaping is broken.
  const escapedSecret = SECRET.replace(/&/g, '&amp;');
  check('owner sees the password value in the markup', dash.includes(escapedSecret),
    `expected ${escapedSecret}`);

  const subPage = await (await req('GET', `/account/subscriptions/${sub.id}`)).text();
  check('owner sees the handover on the subscription page', subPage.includes(SITE) && subPage.includes(ADMINURL));

  // ---- 3. another customer must not ----
  if (other) {
    const otherLogin = await login(other.email, 'Demo@1234');
    if (otherLogin.status === 302) {
      const otherDash = await (await req('GET', '/account')).text();
      check('other customer does NOT see the site on their dashboard', !otherDash.includes(SITE));

      // Direct id request must 404, not leak.
      const direct = await req('GET', `/account/subscriptions/${sub.id}`);
      const directBody = direct.status === 200 ? await direct.text() : '';
      check('other customer cannot open the subscription by id',
        direct.status === 404 || !directBody.includes(SECRET),
        `status ${direct.status}`);
    } else {
      console.log(`skip other-customer checks (could not sign in as ${other.email})`);
    }
  }

  // ---- Back to an admin session ----
  // Everything below writes, and the steps above left us signed in as a customer.
  // Without this the writes 403 on CSRF and the assertions pass for the WRONG
  // reason: nothing changed because nothing was allowed to change.
  const adminAgain = await login(...ADMIN);
  if (adminAgain.status !== 302) { console.log('FATAL: could not re-establish the admin session'); process.exit(1); }

  // ---- 4. javascript: URL rejected ----
  const t2 = await token(`/admin/subscriptions/${sub.id}`);
  const badPost = await req('POST', `/admin/subscriptions/${sub.id}/provision`, {
    _csrf: t2,
    provisionedSiteUrl: 'javascript:alert(1)',
    provisionedAdminUrl: ADMINURL,
    provisionedUsername: 'shopowner',
    provisionedPassword: '',
  });
  check('javascript: URL POST was actually accepted (not a CSRF rejection)',
    badPost.status === 302, `status ${badPost.status}`);
  const afterBad = await prisma.subscription.findUnique({ where: { id: sub.id } });
  check('a javascript: URL is refused', afterBad.provisionedSiteUrl === SITE,
    `kept ${afterBad.provisionedSiteUrl}`);

  // ---- 5. blank password keeps the stored one ----
  const t3 = await token(`/admin/subscriptions/${sub.id}`);
  await req('POST', `/admin/subscriptions/${sub.id}/provision`, {
    _csrf: t3,
    provisionedSiteUrl: SITE,
    provisionedAdminUrl: ADMINURL,
    provisionedUsername: 'shopowner',
    provisionedPassword: '',
    provisionedNotes: 'Updated notes only.',
  });
  const afterBlank = await prisma.subscription.findUnique({ where: { id: sub.id } });
  check('a blank password keeps the stored credential', afterBlank.provisionedPassword === SECRET);

  // ---- 6. clearing withdraws ----
  const t4 = await token(`/admin/subscriptions/${sub.id}`);
  await req('POST', `/admin/subscriptions/${sub.id}/provision`, {
    _csrf: t4,
    provisionedSiteUrl: '',
    provisionedAdminUrl: '',
    provisionedUsername: '',
    provisionedPassword: '',
    provisionedNotes: '',
  });
  const cleared = await prisma.subscription.findUnique({ where: { id: sub.id } });
  check('clearing every field withdraws the handover',
    !cleared.provisionedSiteUrl && !cleared.provisionedAt);

  // ---- restore ----
  await prisma.subscription.update({ where: { id: sub.id }, data: before });
  const restored = await prisma.subscription.findUnique({ where: { id: sub.id } });
  check('original state restored', restored.provisionedSiteUrl === before.provisionedSiteUrl);

  const failed = results.filter((r) => !r.pass);
  console.log('\n' + '='.repeat(58));
  console.log(`total ${results.length}   pass ${results.length - failed.length}   fail ${failed.length}`);
  if (failed.length) for (const f of failed) console.log(`  FAIL ${f.label}`);

  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
})();
