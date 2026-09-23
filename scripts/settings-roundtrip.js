'use strict';

/**
 * Proves the settings form is wired end to end:
 *   admin form  ->  POST /admin/settings  ->  database  ->  rendered public HTML
 *
 * It writes a distinctive colour, a logo and a font, checks each one appears in
 * the public page, then restores the original values so the database is left
 * exactly as it was found.
 *
 * Usage: node scripts/settings-roundtrip.js [baseUrl]
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const prisma = require(path.join(ROOT, 'src/config/prisma'));

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@woohelperpro.com';
const PASS = process.env.ADMIN_PASSWORD || 'WooHelper@2026';

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

const results = [];
function check(label, pass, detail) {
  results.push({ label, pass });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? `   ${detail}` : ''}`);
}

// Build the POST body from a settings row, overriding selected fields.
//
// CRITICAL: every editable column must appear here. The handler treats an absent
// key as "clear it", so a field omitted from this map is WIPED on every run.
// Keep in sync with the update block in src/routes/admin/content.routes.js.
function bodyFrom(row, overrides) {
  const s = { ...row, ...overrides };
  return {
    // identity & contact
    siteName: s.siteName, tagline: s.tagline, taglineBn: s.taglineBn,
    supportEmail: s.supportEmail, supportPhone: s.supportPhone,
    whatsappNumber: s.whatsappNumber, officeAddress: s.officeAddress,
    // branding
    logoUrl: s.logoUrl, logoAlt: s.logoAlt, logoHeightPx: String(s.logoHeightPx), faviconUrl: s.faviconUrl,
    logoUrlLight: s.logoUrlLight, logoUrlDark: s.logoUrlDark,
    heroImageUrl: s.heroImageUrl, heroImageAlt: s.heroImageAlt,
    primaryColor: s.primaryColor, secondaryColor: s.secondaryColor, accentColor: s.accentColor,
    // typography
    fontHeading: s.fontHeading, fontBody: s.fontBody,
    fontHeadingBn: s.fontHeadingBn, fontBodyBn: s.fontBodyBn,
    // payments & tax
    bkashNumber: s.bkashNumber, nagadNumber: s.nagadNumber, rocketNumber: s.rocketNumber,
    bankDetails: s.bankDetails, vatPercent: String(s.vatPercent),
    // payment method logos
    bkashLogoUrl: s.bkashLogoUrl, nagadLogoUrl: s.nagadLogoUrl, rocketLogoUrl: s.rocketLogoUrl,
    sslcommerzLogoUrl: s.sslcommerzLogoUrl, bankLogoUrl: s.bankLogoUrl,
    codLogoUrl: s.codLogoUrl, cardLogoUrl: s.cardLogoUrl,
    // SEO
    metaTitle: s.metaTitle, metaDescription: s.metaDescription,
    metaKeywords: s.metaKeywords, metaRobots: s.metaRobots, ogImageUrl: s.ogImageUrl,
    googleAnalyticsId: s.googleAnalyticsId,
    googleSiteVerification: s.googleSiteVerification, twitterHandle: s.twitterHandle,
    // social
    facebookUrl: s.facebookUrl, youtubeUrl: s.youtubeUrl, linkedinUrl: s.linkedinUrl,
    // general
    timezone: s.timezone, defaultLanguage: s.defaultLanguage,
    dateFormat: s.dateFormat, footerText: s.footerText,
    // mail
    smtpHost: s.smtpHost, smtpPort: String(s.smtpPort), smtpUser: s.smtpUser,
    // A blank password means "keep the stored one", so echoing it back is safe.
    smtpPassword: s.smtpPassword,
    mailFromName: s.mailFromName, mailFromEmail: s.mailFromEmail,
    adminNotificationEmail: s.adminNotificationEmail,
    // crawling
    robotsTxt: s.robotsTxt, robotsExtraDisallow: s.robotsExtraDisallow,
    // Checkboxes. These are the sharpest edge in this file: an unchecked box sends
    // NOTHING, and the handler reads `=== 'on'`, so omitting one silently turns the
    // feature OFF rather than leaving it alone. Echo them back explicitly.
    smtpSecure: s.smtpSecure ? 'on' : '',
    sitemapEnabled: s.sitemapEnabled ? 'on' : '',
    maintenanceMode: s.maintenanceMode ? 'on' : '',
    notifyAdminOnOrder: s.notifyAdminOnOrder ? 'on' : '',
    notifyAdminOnPayment: s.notifyAdminOnPayment ? 'on' : '',
    notifyAdminOnTicket: s.notifyAdminOnTicket ? 'on' : '',
    notifyAdminOnLead: s.notifyAdminOnLead ? 'on' : '',
    notifyCustomerOnOrder: s.notifyCustomerOnOrder ? 'on' : '',
    notifyCustomerOnPayment: s.notifyCustomerOnPayment ? 'on' : '',
  };
}

(async () => {
  console.log(`\nSettings round-trip -> ${BASE}\n`);

  const tok = await token('/login');
  const login = await req('POST', '/login', { _csrf: tok, email: EMAIL, password: PASS });
  if (login.status !== 302) { console.log('FATAL: admin login failed'); process.exit(1); }

  const original = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });

  // ---- Write distinctive values ----
  const TEST = {
    primaryColor: '#c81e5a',
    accentColor: '#0ea5e9',
    fontHeading: 'Poppins',
    fontBody: 'Roboto',
    logoUrl: '/images/logo-test.svg',
    // All three logo slots point at the test file. The resolver prefers the
    // theme-specific one, so setting only logoUrl would be shadowed by whatever
    // logoUrlLight already holds and the assertion would fail for the right reason
    // but the wrong cause.
    logoUrlLight: '/images/logo-test.svg',
    logoUrlDark: '/images/logo-test.svg',
    logoAlt: 'Round-trip logo',
    logoHeightPx: '40',
    faviconUrl: '/images/favicon-test.svg',
    footerText: 'ROUNDTRIP-FOOTER-MARKER',
    metaKeywords: 'roundtrip-keyword-marker',
    googleSiteVerification: 'roundtrip-verify-marker',
    twitterHandle: '@roundtrip',
    timezone: 'Asia/Kolkata',
    defaultLanguage: 'bn',
    dateFormat: 'YYYY-MM-DD',
  };

  const t = await token('/admin/settings');
  const save = await req('POST', '/admin/settings', { _csrf: t, ...bodyFrom(original, TEST) });
  check('POST /admin/settings accepted', save.status === 302, `status ${save.status}`);

  // ---- Database ----
  const after = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });
  for (const k of ['primaryColor', 'accentColor', 'fontHeading', 'fontBody', 'logoUrl',
    'logoHeightPx', 'faviconUrl', 'footerText', 'metaKeywords', 'googleSiteVerification',
    'timezone', 'defaultLanguage', 'dateFormat']) {
    const want = k === 'logoHeightPx' ? 40 : TEST[k];
    check(`db.${k}`, after[k] === want, `got ${JSON.stringify(after[k])}`);
  }
  // twitterHandle is stored WITHOUT the leading '@' -- the layout adds it back
  // when rendering, so storing it here would produce "@@handle".
  check('db.twitterHandle (leading @ stripped)', after.twitterHandle === 'roundtrip',
    `got ${JSON.stringify(after.twitterHandle)}`);

  // ---- Rendered public HTML ----
  const home = await (await req('GET', '/')).text();
  // The primary colour is now the BASE of a derived ramp rather than being
  // stamped onto --brand-600 directly, so assert on --brand-base and check that
  // --brand-600 is derived FROM it. Asserting the old literal would fail while the
  // behaviour is actually correct.
  check('home: primary colour injected as the ramp base',
    home.includes('--brand-base: #c81e5a'));
  check('home: ramp derived from the base',
    /--brand-600:\s*color-mix\(in srgb, var\(--brand-base\)/.test(home));
  check('home: tint steps scoped to light mode',
    /:root:not\(\[data-theme="dark"\]\)[\s\S]{0,400}--brand-50:/.test(home));
  check('home: accent colour injected', home.includes('--accent-500: #0ea5e9'));
  check('home: heading font requested', /family=Poppins/.test(home));
  check('home: body font requested', /family=Roboto/.test(home));
  check('home: logo img rendered', home.includes('src="/images/logo-test.svg"'));
  check('home: logo height applied', home.includes('height:40px'));
  check('home: favicon from settings', home.includes('href="/images/favicon-test.svg"'));
  check('home: footer text rendered', home.includes('ROUNDTRIP-FOOTER-MARKER'));
  check('home: meta keywords rendered', home.includes('roundtrip-keyword-marker'));
  check('home: verification tag rendered', home.includes('roundtrip-verify-marker'));
  check('home: twitter handle rendered', home.includes('@roundtrip'));

  // ---- Validation: bad colour must not be written ----
  const t2 = await token('/admin/settings');
  await req('POST', '/admin/settings', {
    _csrf: t2,
    ...bodyFrom(after, { primaryColor: 'red; } body { display:none } .x{' }),
  });
  const guard = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });
  check('rejects CSS-injection in a colour field',
    guard.primaryColor === '#c81e5a', `kept ${guard.primaryColor}`);

  // ---- Restore ----
  const t3 = await token('/admin/settings');
  const restore = await req('POST', '/admin/settings', { _csrf: t3, ...bodyFrom(original) });
  const final = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });
  check('restored original settings', restore.status === 302 && final.primaryColor === original.primaryColor,
    `primaryColor ${final.primaryColor}`);

  const failed = results.filter((r) => !r.pass);
  console.log('\n' + '='.repeat(58));
  console.log(`total ${results.length}   pass ${results.length - failed.length}   fail ${failed.length}`);
  if (failed.length) for (const f of failed) console.log(`  FAIL ${f.label}`);

  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
})();
