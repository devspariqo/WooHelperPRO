'use strict';

/**
 * Mailer with a development fallback.
 *
 * If SMTP is not configured we log the message instead of throwing, so the
 * whole order/subscription flow stays testable without an SMTP server.
 */

const config = require('../config');

let transporter = null;
let nodemailer = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!config.mail.host) return null;
  try {
    nodemailer = nodemailer || require('nodemailer');
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.password } : undefined,
    });
    return transporter;
  } catch (err) {
    console.warn('[mail] transporter unavailable:', err.message);
    return null;
  }
}

async function send({ to, subject, html, text }) {
  const tx = getTransporter();
  if (!tx) {
    console.log(`\n[mail:dev] To: ${to}\n[mail:dev] Subject: ${subject}\n[mail:dev] ${(text || html || '').slice(0, 200)}...\n`);
    return { queued: false, mode: 'development-log' };
  }
  try {
    const info = await tx.sendMail({ from: config.mail.from, to, subject, html, text });
    return { queued: true, messageId: info.messageId };
  } catch (err) {
    console.error('[mail] send failed:', err.message);
    return { queued: false, error: err.message };
  }
}

// ---------------------------------------------------------------
// Transactional templates
// ---------------------------------------------------------------

const wrap = (body) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827">
  <div style="border-bottom:3px solid #6d28d9;padding-bottom:12px;margin-bottom:20px">
    <h1 style="margin:0;font-size:20px;color:#6d28d9">WooHelperPro</h1>
    <p style="margin:4px 0 0;font-size:12px;color:#6b7280">Bangladesh e-commerce website design &amp; management</p>
  </div>
  ${body}
  <div style="border-top:1px solid #e5e7eb;margin-top:28px;padding-top:12px;font-size:12px;color:#9ca3af">
    This is an automated message. Reply to this email or open a support ticket from your dashboard.
  </div>
</div>`;

const templates = {
  welcome: (user) => ({
    subject: 'Welcome to WooHelperPro — your account is ready',
    html: wrap(`
      <p>Hi ${user.name},</p>
      <p>Your WooHelperPro account has been created. You can now order website design packages,
      track project progress and manage your subscription from one dashboard.</p>
      <p><a href="${config.appUrl}/login" style="display:inline-block;background:#6d28d9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Sign in to your dashboard</a></p>
      <p style="font-size:13px;color:#6b7280">Need help choosing a package? Reply to this email or call us — we answer in Bangla and English.</p>`),
    text: `Welcome to WooHelperPro, ${user.name}. Sign in at ${config.appUrl}/login`,
  }),

  orderPlaced: (order) => ({
    subject: `Order received — ${order.orderNumber}`,
    html: wrap(`
      <p>Thank you. We have received your order <strong>${order.orderNumber}</strong> for
      <strong>${order.projectName}</strong>.</p>
      <p>Our team will review your requirements and contact you within one business day to confirm
      scope and payment.</p>
      <p><a href="${config.appUrl}/account/orders/${order.id}" style="display:inline-block;background:#6d28d9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">View order</a></p>`),
    text: `Order ${order.orderNumber} received. View it at ${config.appUrl}/account/orders/${order.id}`,
  }),

  orderStatus: (order, statusLabel) => ({
    subject: `Order ${order.orderNumber} is now ${statusLabel}`,
    html: wrap(`
      <p>Your order <strong>${order.orderNumber}</strong> has moved to <strong>${statusLabel}</strong>.</p>
      <p><a href="${config.appUrl}/account/orders/${order.id}" style="display:inline-block;background:#6d28d9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Track progress</a></p>`),
    text: `Order ${order.orderNumber} status: ${statusLabel}`,
  }),

  invoice: (invoice) => ({
    subject: `Invoice ${invoice.invoiceNumber} from WooHelperPro`,
    html: wrap(`
      <p>Invoice <strong>${invoice.invoiceNumber}</strong> has been issued.</p>
      <p>Amount due: <strong>BDT ${Number(invoice.total).toLocaleString('en-BD')}</strong><br>
      Due date: <strong>${new Date(invoice.dueDate).toDateString()}</strong></p>
      <p><a href="${config.appUrl}/account/invoices/${invoice.id}" style="display:inline-block;background:#6d28d9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">View &amp; pay invoice</a></p>`),
    text: `Invoice ${invoice.invoiceNumber} — BDT ${invoice.total}. Pay at ${config.appUrl}/account/invoices/${invoice.id}`,
  }),

  paymentReceived: (payment) => ({
    subject: `Payment confirmed — ${payment.reference}`,
    html: wrap(`
      <p>We have received your payment of <strong>BDT ${Number(payment.amount).toLocaleString('en-BD')}</strong>
      via <strong>${payment.method}</strong>.</p>
      <p>Reference: <strong>${payment.reference}</strong></p>`),
    text: `Payment confirmed: BDT ${payment.amount} via ${payment.method} (${payment.reference})`,
  }),

  subscriptionRenewal: (subscription, days) => ({
    subject: `Your ${subscription.planName} plan renews in ${days} days`,
    html: wrap(`
      <p>Your <strong>${subscription.planName}</strong> subscription will renew on
      <strong>${new Date(subscription.currentPeriodEnd).toDateString()}</strong>.</p>
      <p>Amount: <strong>BDT ${Number(subscription.amount).toLocaleString('en-BD')}</strong></p>
      <p><a href="${config.appUrl}/account/subscriptions/${subscription.id}" style="display:inline-block;background:#6d28d9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Manage subscription</a></p>`),
    text: `${subscription.planName} renews in ${days} days.`,
  }),
};

module.exports = { send, templates };
