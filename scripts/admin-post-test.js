'use strict';

/**
 * Admin POST round-trip tests.
 *
 * Every action is chosen to be SELF-REVERSING: it is performed twice, or performed
 * with the value already in place, so the database ends up exactly as it started.
 * That way a form can be proven to work without leaving test residue behind.
 *
 * Usage: node scripts/admin-post-test.js [baseUrl]
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const prisma = require(path.join(ROOT, 'src/config/prisma'));

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@woohelperpro.com';
const PASS = process.env.ADMIN_PASSWORD || 'WooHelper@2026';

let COOKIE = '';
let TOKEN = '';

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
  if (body) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body).toString();
  }
  const res = await fetch(`${BASE}${url}`, { method, headers, body: payload, redirect: 'manual' });
  store(res);
  return res;
}

async function formToken(pathname) {
  const res = await req('GET', pathname);
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]*)"/);
  return m ? m[1] : '';
}

/**
 * Build the /admin/settings form body from a FULL SiteSetting row.
 *
 * Every editable column must appear here. The settings handler writes whatever it
 * receives and treats an absent key as an empty string, so omitting a field
 * CLEARS it. Keep this in sync with the update block in
 * src/routes/admin/content.routes.js -- if you add a column there, add it here,
 * or this test will quietly erase it.
 */
function settingsBody(row) {
  return {
    // identity & contact
    siteName: row.siteName,
    tagline: row.tagline,
    taglineBn: row.taglineBn,
    supportEmail: row.supportEmail,
    supportPhone: row.supportPhone,
    whatsappNumber: row.whatsappNumber,
    officeAddress: row.officeAddress,
    // branding
    logoUrl: row.logoUrl,
    logoAlt: row.logoAlt,
    logoHeightPx: String(row.logoHeightPx),
    faviconUrl: row.faviconUrl,
    primaryColor: row.primaryColor,
    secondaryColor: row.secondaryColor,
    accentColor: row.accentColor,
    // typography
    fontHeading: row.fontHeading,
    fontBody: row.fontBody,
    fontHeadingBn: row.fontHeadingBn,
    fontBodyBn: row.fontBodyBn,
    // payments & tax
    bkashNumber: row.bkashNumber,
    nagadNumber: row.nagadNumber,
    rocketNumber: row.rocketNumber,
    bankDetails: row.bankDetails,
    vatPercent: String(row.vatPercent),
    // SEO
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    metaKeywords: row.metaKeywords,
    metaRobots: row.metaRobots,
    ogImageUrl: row.ogImageUrl,
    googleAnalyticsId: row.googleAnalyticsId,
    googleSiteVerification: row.googleSiteVerification,
    twitterHandle: row.twitterHandle,
    // social
    facebookUrl: row.facebookUrl,
    youtubeUrl: row.youtubeUrl,
    linkedinUrl: row.linkedinUrl,
    // general
    timezone: row.timezone,
    defaultLanguage: row.defaultLanguage,
    dateFormat: row.dateFormat,
    footerText: row.footerText,
    // payment method logos
    bkashLogoUrl: row.bkashLogoUrl,
    nagadLogoUrl: row.nagadLogoUrl,
    rocketLogoUrl: row.rocketLogoUrl,
    sslcommerzLogoUrl: row.sslcommerzLogoUrl,
    bankLogoUrl: row.bankLogoUrl,
    codLogoUrl: row.codLogoUrl,
    cardLogoUrl: row.cardLogoUrl,
    // mail
    smtpHost: row.smtpHost,
    smtpPort: String(row.smtpPort),
    smtpUser: row.smtpUser,
    smtpPassword: row.smtpPassword,
    mailFromName: row.mailFromName,
    mailFromEmail: row.mailFromEmail,
    adminNotificationEmail: row.adminNotificationEmail,
    // crawling
    robotsTxt: row.robotsTxt,
    robotsExtraDisallow: row.robotsExtraDisallow,
    // Checkboxes: an unchecked box sends nothing and the handler reads `=== 'on'`,
    // so an omitted box turns the feature OFF rather than leaving it alone.
    smtpSecure: row.smtpSecure ? 'on' : '',
    sitemapEnabled: row.sitemapEnabled ? 'on' : '',
    maintenanceMode: row.maintenanceMode ? 'on' : '',
    notifyAdminOnOrder: row.notifyAdminOnOrder ? 'on' : '',
    notifyAdminOnPayment: row.notifyAdminOnPayment ? 'on' : '',
    notifyAdminOnTicket: row.notifyAdminOnTicket ? 'on' : '',
    notifyAdminOnLead: row.notifyAdminOnLead ? 'on' : '',
    notifyCustomerOnOrder: row.notifyCustomerOnOrder ? 'on' : '',
    notifyCustomerOnPayment: row.notifyCustomerOnPayment ? 'on' : '',
  };
}

const results = [];
function record(label, status, want, extra) {
  const ok = status === want;
  results.push({ label, status, want, ok, extra });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(status).padEnd(4)} ${label}${extra ? `   ${extra}` : ''}`);
}

(async () => {
  console.log(`\nAdmin POST round-trip tests -> ${BASE}\n`);

  TOKEN = await formToken('/login');
  const login = await req('POST', '/login', { _csrf: TOKEN, email: EMAIL, password: PASS });
  if (login.status !== 302) { console.log('FATAL: admin login failed'); process.exit(1); }

  // ---- 1. Settings save round-trip (re-post the values already stored) ----
  //
  // CRITICAL: build the body from EVERY column in the row, not a hand-picked
  // subset. The settings handler treats an absent field as "clear it", which is
  // correct for a real form submit but destructive here: an earlier version of
  // this script listed only the fields that existed at the time, and silently
  // wiped logoUrl, faviconUrl, metaKeywords and footerText on every run. Fields
  // whose handler has a fallback (colours, fonts, logoHeightPx) survived, which
  // made the damage look partial and easy to miss.
  const before = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });
  const tok1 = await formToken('/admin/settings');
  const save = await req('POST', '/admin/settings', {
    _csrf: tok1,
    ...settingsBody(before),
  });
  record('POST /admin/settings (save)', save.status, 302);
  const after = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });
  console.log(`      siteName preserved: ${before.siteName === after.siteName ? 'yes' : 'NO'}`);
  {
    // Guard the exact regression above: assert nothing was cleared. `updatedAt`
    // is expected to move on every write, so it is excluded.
    const cleared = Object.keys(before).filter((k) => k !== 'updatedAt' && k !== 'id'
      && before[k] !== after[k]);
    record('settings save is lossless (no field cleared)',
      cleared.length === 0 ? 302 : 500, 302,
      cleared.length ? `changed: ${cleared.join(', ')}` : 'all fields intact');
  }

  // ---- 2. Milestone toggle, twice -> back to original ----
  const ms = await prisma.projectMilestone.findFirst();
  if (ms) {
    const orig = ms.isDone;
    const t2 = await formToken('/admin/projects');
    await req('POST', `/admin/projects/milestones/${ms.id}/toggle`, { _csrf: t2 });
    const mid = await prisma.projectMilestone.findUnique({ where: { id: ms.id } });
    const t3 = await formToken('/admin/projects');
    await req('POST', `/admin/projects/milestones/${ms.id}/toggle`, { _csrf: t3 });
    const end = await prisma.projectMilestone.findUnique({ where: { id: ms.id } });
    record('POST /admin/projects/milestones/:id/toggle (x2)',
      end.isDone === orig ? 302 : 500, 302,
      `toggled ${orig} -> ${mid.isDone} -> ${end.isDone}`);
  } else {
    console.log('skip  no project milestone in the dataset');
  }

  // ---- 3. Coupon toggle, twice -> back to original ----
  const coupon = await prisma.coupon.findFirst();
  if (coupon) {
    const orig = coupon.isActive;
    const t4 = await formToken('/admin/coupons');
    await req('POST', `/admin/coupons/${coupon.id}/toggle`, { _csrf: t4 });
    const t5 = await formToken('/admin/coupons');
    await req('POST', `/admin/coupons/${coupon.id}/toggle`, { _csrf: t5 });
    const end = await prisma.coupon.findUnique({ where: { id: coupon.id } });
    record('POST /admin/coupons/:id/toggle (x2)',
      end.isActive === orig ? 302 : 500, 302,
      `toggled ${orig} -> ${end.isActive}`);
  } else {
    console.log('skip  no coupon in the dataset');
  }

  // ---- 4. Ticket status set to its CURRENT value ----
  const ticket = await prisma.ticket.findFirst();
  if (ticket) {
    const t6 = await formToken(`/admin/tickets/${ticket.id}`);
    const res = await req('POST', `/admin/tickets/${ticket.id}/status`, {
      _csrf: t6, status: ticket.status,
    });
    record('POST /admin/tickets/:id/status (same value)', res.status, 302, `status=${ticket.status}`);
  } else {
    console.log('skip  no ticket in the dataset');
  }

  // ---- 5. Lead update with its CURRENT values ----
  const lead = await prisma.lead.findFirst();
  if (lead) {
    const t7 = await formToken('/admin/leads');
    const res = await req('POST', `/admin/leads/${lead.id}`, {
      _csrf: t7, status: lead.status, notes: lead.notes || '', assignedTo: lead.assignedTo || '',
    });
    record('POST /admin/leads/:id (same values)', res.status, 302, `status=${lead.status}`);
  } else {
    console.log('skip  no lead in the dataset');
  }

  // ---- 6. CSRF must be enforced on admin POSTs ----
  const noTok = await req('POST', '/admin/settings', { siteName: 'hacked' });
  record('POST /admin/settings without _csrf (must be 403)', noTok.status, 403);

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(58));
  console.log(`total ${results.length}   pass ${results.length - failed.length}   fail ${failed.length}`);
  if (failed.length) for (const f of failed) console.log(`  FAIL ${f.status} (want ${f.want}) ${f.label}`);

  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
})();
