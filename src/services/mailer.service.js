'use strict';

/**
 * Outbound mail.
 *
 * SMTP is resolved at send time from the SiteSetting row, falling back to the
 * SMTP_* environment variables. Reading it per-send rather than caching a single
 * transport means an operator can fix a wrong port in the admin panel and have
 * the very next email work, without a restart.
 *
 * When SMTP is not configured at all the message is logged instead of throwing,
 * so the whole order/subscription flow stays testable without a mail server.
 */

const config = require('../config');
const prisma = require('../config/prisma');

let nodemailer = null;

/**
 * Resolve transport settings: database first, environment second.
 * Returns null when there is no host, meaning "not configured".
 */
async function resolveSettings(override) {
  let s = override || null;
  if (!s) {
    try {
      s = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });
    } catch {
      s = null;
    }
  }
  const db = s || {};

  const host = (db.smtpHost || config.mail.host || '').trim();
  if (!host) return null;

  const port = Number(db.smtpPort) || config.mail.port || 587;
  const user = (db.smtpUser || config.mail.user || '').trim();
  const pass = db.smtpPassword || config.mail.password || '';

  // A database boolean wins, but when only env is configured fall back to the
  // conventional rule that port 465 means implicit TLS.
  const secure = typeof db.smtpSecure === 'boolean' && db.smtpHost
    ? db.smtpSecure
    : port === 465;

  const fromName = (db.mailFromName || '').trim() || db.siteName || config.appName;
  const fromEmail = (db.mailFromEmail || '').trim()
    || (config.mail.from.match(/<([^>]+)>/) || [])[1]
    || 'no-reply@woohelperpro.com';

  return { host, port, secure, user, pass, fromName, fromEmail };
}

async function getTransporter(override) {
  const s = await resolveSettings(override);
  if (!s) return null;
  try {
    nodemailer = nodemailer || require('nodemailer');
    const tx = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      auth: s.user ? { user: s.user, pass: s.pass } : undefined,
      // Without a timeout a wrong host hangs the request that triggered the mail.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
    return { tx, s };
  } catch (err) {
    console.warn('[mail] transporter unavailable:', err.message);
    return null;
  }
}

async function send({ to, subject, html, text }, opts = {}) {
  if (!to) return { queued: false, error: 'no recipient' };

  const t = await getTransporter(opts.settings);
  if (!t) {
    console.log(`\n[mail:dev] To: ${to}\n[mail:dev] Subject: ${subject}\n[mail:dev] ${(text || html || '').slice(0, 200)}...\n`);
    return { queued: false, mode: 'development-log' };
  }

  try {
    const info = await t.tx.sendMail({
      from: `"${t.s.fromName}" <${t.s.fromEmail}>`,
      to,
      subject,
      html,
      text,
    });
    return { queued: true, messageId: info.messageId };
  } catch (err) {
    console.error('[mail] send failed:', err.message);
    return { queued: false, error: err.message };
  }
}

/** Used by the "send test email" button in the admin panel. */
async function sendTest({ to, settings }) {
  const brand = (settings && settings.primaryColor) || '#7c3aed';
  return send({
    to,
    subject: 'WooHelperPro — SMTP test',
    html: wrap(`
      <p>This is a test message from your WooHelperPro admin panel.</p>
      <p>If you are reading it, outbound mail is configured correctly and order,
      payment and support notifications will be delivered.</p>`, brand, settings),
    text: 'WooHelperPro SMTP test — delivery is working.',
  }, { settings });
}

// ---------------------------------------------------------------
// Layout
// ---------------------------------------------------------------

/**
 * Email wrapper. Colours come from the admin's branding so the mail matches the
 * site, with hardcoded fallbacks because email clients do not support CSS
 * variables -- everything here must be inlined.
 */
function wrap(body, brand, settings) {
  const accent = brand || '#7c3aed';
  const name = (settings && settings.siteName) || 'WooHelperPro';
  const tagline = (settings && settings.tagline) || 'Bangladesh e-commerce website design & management';
  const phone = (settings && settings.supportPhone) || '';
  const email = (settings && settings.supportEmail) || '';

  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827">
  <div style="border-bottom:3px solid ${accent};padding-bottom:12px;margin-bottom:20px">
    <h1 style="margin:0;font-size:20px;color:${accent}">${name}</h1>
    <p style="margin:4px 0 0;font-size:12px;color:#6b7280">${tagline}</p>
  </div>
  ${body}
  <div style="border-top:1px solid #e5e7eb;margin-top:28px;padding-top:12px;font-size:12px;color:#9ca3af">
    This is an automated message.${email ? ` Reply to this email or contact ${email}.` : ''}${phone ? ` Call ${phone}.` : ''}
  </div>
</div>`;
}

const btn = (href, label, brand) =>
  `<p><a href="${href}" style="display:inline-block;background:${brand};color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${label}</a></p>`;

// ---------------------------------------------------------------
// Customer-facing templates
// ---------------------------------------------------------------

const templates = {
  welcome: (user, settings, brand) => ({
    subject: `Welcome to ${settings.siteName || 'WooHelperPro'} — your account is ready`,
    html: wrap(`
      <p>Hi ${user.name},</p>
      <p>Your account has been created. You can now order website design packages,
      track project progress and manage your subscription from one dashboard.</p>
      ${btn(`${config.appUrl}/login`, 'Sign in to your dashboard', brand)}`, brand, settings),
    text: `Welcome, ${user.name}. Sign in at ${config.appUrl}/login`,
  }),

  orderPlaced: (order, settings, brand) => ({
    subject: `Order received — ${order.orderNumber}`,
    html: wrap(`
      <p>Thank you. We have received your order <strong>${order.orderNumber}</strong> for
      <strong>${order.projectName}</strong>.</p>
      <p>Our team will review your requirements and contact you within one business day to confirm
      scope and payment.</p>
      ${btn(`${config.appUrl}/account/orders/${order.id}`, 'View order', brand)}`, brand, settings),
    text: `Order ${order.orderNumber} received. View it at ${config.appUrl}/account/orders/${order.id}`,
  }),

  orderStatus: (order, statusLabel, settings, brand) => ({
    subject: `Order ${order.orderNumber} is now ${statusLabel}`,
    html: wrap(`
      <p>Your order <strong>${order.orderNumber}</strong> has moved to <strong>${statusLabel}</strong>.</p>
      ${btn(`${config.appUrl}/account/orders/${order.id}`, 'Track progress', brand)}`, brand, settings),
    text: `Order ${order.orderNumber} status: ${statusLabel}`,
  }),

  invoice: (invoice, settings, brand) => ({
    subject: `Invoice ${invoice.invoiceNumber} from ${settings.siteName || 'WooHelperPro'}`,
    html: wrap(`
      <p>Invoice <strong>${invoice.invoiceNumber}</strong> has been issued.</p>
      <p>Amount due: <strong>BDT ${Number(invoice.total).toLocaleString('en-BD')}</strong><br>
      Due date: <strong>${new Date(invoice.dueDate).toDateString()}</strong></p>
      ${btn(`${config.appUrl}/account/invoices/${invoice.id}`, 'View &amp; pay invoice', brand)}`, brand, settings),
    text: `Invoice ${invoice.invoiceNumber} — BDT ${invoice.total}. Pay at ${config.appUrl}/account/invoices/${invoice.id}`,
  }),

  paymentReceived: (payment, settings, brand) => ({
    subject: `Payment confirmed — ${payment.reference}`,
    html: wrap(`
      <p>We have received your payment of <strong>BDT ${Number(payment.amount).toLocaleString('en-BD')}</strong>
      via <strong>${payment.method}</strong>.</p>
      <p>Reference: <strong>${payment.reference}</strong></p>`, brand, settings),
    text: `Payment confirmed: BDT ${payment.amount} via ${payment.method} (${payment.reference})`,
  }),

  subscriptionRenewal: (subscription, days, settings, brand) => ({
    subject: `Your ${subscription.planName} plan renews in ${days} days`,
    html: wrap(`
      <p>Your <strong>${subscription.planName}</strong> subscription will renew on
      <strong>${new Date(subscription.currentPeriodEnd).toDateString()}</strong>.</p>
      <p>Amount: <strong>BDT ${Number(subscription.amount).toLocaleString('en-BD')}</strong></p>
      ${btn(`${config.appUrl}/account/subscriptions/${subscription.id}`, 'Manage subscription', brand)}`, brand, settings),
    text: `${subscription.planName} renews in ${days} days.`,
  }),

  // ---- Admin-facing ----
  adminNewOrder: (order, settings, brand) => ({
    subject: `[New order] ${order.orderNumber} — ${order.projectName}`,
    html: wrap(`
      <p>A new order has been placed.</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Order</td><td><strong>${order.orderNumber}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Project</td><td>${order.projectName}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Contact</td><td>${order.contactName || ''} ${order.contactPhone || ''}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Email</td><td>${order.contactEmail || ''}</td></tr>
      </table>
      ${btn(`${config.appUrl}/admin/orders/${order.id}`, 'Open in admin panel', brand)}`, brand, settings),
    text: `New order ${order.orderNumber} — ${order.projectName}`,
  }),

  adminNewPayment: (payment, settings, brand) => ({
    subject: `[Payment] BDT ${payment.amount} — ${payment.reference}`,
    html: wrap(`
      <p>A payment is awaiting verification.</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Amount</td><td><strong>BDT ${Number(payment.amount).toLocaleString('en-BD')}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Method</td><td>${payment.method}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Reference</td><td>${payment.reference}</td></tr>
      </table>
      ${btn(`${config.appUrl}/admin/payments`, 'Review payments', brand)}`, brand, settings),
    text: `Payment BDT ${payment.amount} via ${payment.method} (${payment.reference})`,
  }),

  adminNewTicket: (ticket, settings, brand) => ({
    subject: `[Support] ${ticket.subject}`,
    html: wrap(`
      <p>A new support ticket has been opened.</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Subject</td><td><strong>${ticket.subject}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Priority</td><td>${ticket.priority || 'NORMAL'}</td></tr>
      </table>
      ${btn(`${config.appUrl}/admin/tickets/${ticket.id}`, 'Open ticket', brand)}`, brand, settings),
    text: `New ticket: ${ticket.subject}`,
  }),

  adminNewLead: (lead, settings, brand) => ({
    subject: `[Lead] ${lead.name || lead.email || 'New enquiry'}`,
    html: wrap(`
      <p>A new enquiry has arrived.</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Name</td><td><strong>${lead.name || ''}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Phone</td><td>${lead.phone || ''}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Email</td><td>${lead.email || ''}</td></tr>
      </table>
      ${btn(`${config.appUrl}/admin/leads`, 'Open leads', brand)}`, brand, settings),
    text: `New lead: ${lead.name || lead.email || ''}`,
  }),
};

/**
 * Build a template and send it in one call.
 *
 * Reads the settings row once so the branding is right, and respects the
 * per-event switches. `kind` is 'customer' or 'admin' -- admin mail goes to the
 * configured notification address and is skipped when that event is switched off.
 */
async function notify(templateName, args, { kind = 'customer', to } = {}) {
  let settings = {};
  try {
    settings = (await prisma.siteSetting.findUnique({ where: { id: 'singleton' } })) || {};
  } catch {
    settings = {};
  }

  const brand = settings.primaryColor || '#7c3aed';
  const build = templates[templateName];
  if (!build) {
    console.warn('[mail] unknown template:', templateName);
    return { queued: false, error: 'unknown template' };
  }

  if (kind === 'admin') {
    const switches = {
      adminNewOrder: 'notifyAdminOnOrder',
      adminNewPayment: 'notifyAdminOnPayment',
      adminNewTicket: 'notifyAdminOnTicket',
      adminNewLead: 'notifyAdminOnLead',
    };
    const flag = switches[templateName];
    if (flag && settings[flag] === false) return { queued: false, skipped: 'disabled' };

    to = to || settings.adminNotificationEmail || settings.supportEmail || config.mail.user;
    if (!to) return { queued: false, skipped: 'no-admin-recipient' };
  } else {
    const switches = {
      orderPlaced: 'notifyCustomerOnOrder',
      orderStatus: 'notifyCustomerOnOrder',
      paymentReceived: 'notifyCustomerOnPayment',
    };
    const flag = switches[templateName];
    if (flag && settings[flag] === false) return { queued: false, skipped: 'disabled' };
    if (!to) return { queued: false, skipped: 'no-recipient' };
  }

  const msg = build(...args, settings, brand);
  return send({ to, ...msg }, { settings });
}

module.exports = { send, sendTest, templates, notify, wrap, resolveSettings };
