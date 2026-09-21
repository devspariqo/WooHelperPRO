'use strict';

/**
 * Sidebar permission verification.
 *
 * Checks two things that pull in opposite directions:
 *   1. Every sidebar item a role IS entitled to actually renders (the bug: the
 *      whole admin sidebar rendered empty for every role, because `can()` was
 *      comparing a permission name against a role name).
 *   2. No item a role is NOT entitled to renders (the risk in fixing it: a
 *      blanket "always true" would expose Settings and Users to Support staff).
 *
 * Expected sets come from the PERMISSIONS matrix in src/middleware/auth.js, read
 * at runtime rather than hardcoded, so this cannot drift from the real policy.
 *
 * Usage: node scripts/sidebar-permission-test.js [baseUrl]
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { PERMISSIONS } = require(path.join(ROOT, 'src/middleware/auth'));

const BASE = process.argv[2] || 'http://127.0.0.1:3000';

// Sidebar item -> the permission that gates it. Mirrors views/partials/sidebar.ejs.
const SIDEBAR = [
  ['/admin', 'dashboard'],
  ['/admin/reports', 'reports'],
  ['/admin/orders', 'orders'],
  ['/admin/leads', 'leads'],
  ['/admin/coupons', 'coupons'],
  ['/admin/users', 'users'],
  ['/admin/subscriptions', 'subscriptions'],
  ['/admin/invoices', 'invoices'],
  ['/admin/payments', 'payments'],
  ['/admin/services', 'services'],
  ['/admin/packages', 'packages'],
  ['/admin/projects', 'projects'],
  ['/admin/tickets', 'tickets'],
  ['/admin/portfolio', 'portfolio'],
  ['/admin/blog', 'content'],
  ['/admin/faqs', 'content'],
  ['/admin/testimonials', 'testimonials'],
  ['/admin/media', 'media'],
  ['/admin/settings', 'settings'],
  ['/admin/activity', 'activity'],
];

const STAFF = [
  ['SUPER_ADMIN', 'admin@woohelperpro.com', 'WooHelper@2026'],
  ['ADMIN', 'imran@woohelperpro.com', 'Demo@1234'],
  ['MANAGER', 'nusrat@woohelperpro.com', 'Demo@1234'],
  ['SUPPORT', 'farhana@woohelperpro.com', 'Demo@1234'],
  ['STAFF', 'tanvir@woohelperpro.com', 'Demo@1234'],
];

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

async function sidebarFor(email, password) {
  COOKIE = '';
  const loginHtml = await (await req('GET', '/login')).text();
  const m = loginHtml.match(/name="_csrf" value="([^"]*)"/);
  const res = await req('POST', '/login', { _csrf: m ? m[1] : '', email, password });
  if (res.status !== 302) return { error: `login ${res.status}` };

  const html = await (await req('GET', '/admin')).text();
  const nav = html.match(/<nav class="sidebar-nav"[\s\S]*?<\/nav>/);
  if (!nav) return { error: 'no sidebar in response' };
  const hrefs = new Set([...nav[0].matchAll(/href="([^"]+)"/g)].map((x) => x[1]));
  return { hrefs };
}

(async () => {
  console.log(`\nSidebar permission check -> ${BASE}\n`);
  let failures = 0;

  for (const [role, email, password] of STAFF) {
    const r = await sidebarFor(email, password);
    if (r.error) {
      console.log(`FAIL ${role.padEnd(12)} could not load sidebar: ${r.error}`);
      failures += 1;
      continue;
    }

    const shouldShow = SIDEBAR.filter(([, perm]) => (PERMISSIONS[perm] || []).includes(role))
      .map(([href]) => href);
    const shouldHide = SIDEBAR.filter(([, perm]) => !(PERMISSIONS[perm] || []).includes(role))
      .map(([href]) => href);

    const missing = shouldShow.filter((h) => !r.hrefs.has(h));
    const leaked = shouldHide.filter((h) => r.hrefs.has(h));

    const ok = missing.length === 0 && leaked.length === 0;
    if (!ok) failures += 1;

    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${role.padEnd(12)} shows ${String(shouldShow.length).padStart(2)}` +
      ` / hides ${String(shouldHide.length).padStart(2)}` +
      (missing.length ? `   MISSING: ${missing.join(', ')}` : '') +
      (leaked.length ? `   LEAKED: ${leaked.join(', ')}` : '')
    );
  }

  // Every sidebar link a super admin can see must actually resolve.
  console.log('\n--- super-admin link reachability ---');
  const su = await sidebarFor(STAFF[0][1], STAFF[0][2]);
  if (!su.error) {
    let bad = 0;
    for (const href of [...su.hrefs].sort()) {
      const res = await req('GET', href);
      const ok = res.status === 200;
      if (!ok) { bad += 1; failures += 1; }
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(res.status).padEnd(4)} ${href}`);
    }
    if (!bad) console.log('      all sidebar destinations returned 200');
  }

  console.log('\n' + '='.repeat(58));
  console.log(failures ? `${failures} failure(s)` : 'all sidebar permission checks passed');
  process.exit(failures ? 1 : 0);
})();
