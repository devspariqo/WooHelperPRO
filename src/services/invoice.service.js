'use strict';

const prisma = require('../config/prisma');
const ids = require('../utils/ids');
const { date: fmtDate, daysUntil } = require('../utils/format');

/**
 * Invoicing. Invoices are generated from orders (build fee) and from
 * subscriptions (recurring renewals). Totals are recomputed from payments so
 * the paid amount is always derived, never hand-maintained.
 */

/**
 * Next invoice number.
 *
 * The NNNN suffix is a global counter that keeps climbing across months, so it
 * must be derived from the highest existing number -- not from a per-month row
 * count, which collides as soon as an older month holds a higher sequence.
 * (`invoiceNumber` is @unique; a collision is a 500 on customer checkout.)
 */
async function nextInvoiceNumber() {
  const latest = await prisma.invoice.findFirst({
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  });
  return ids.invoiceNumber(ids.nextSequenceFrom(latest && latest.invoiceNumber));
}

/**
 * Create an invoice, retrying if a concurrent write claimed the same number
 * between our read and our insert.
 */
async function createInvoiceWithNumberRetry(input, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await createInvoiceOnce(input);
    } catch (err) {
      const isDup =
        err && err.code === 'P2002' &&
        Array.isArray(err.meta && err.meta.target) &&
        err.meta.target.includes('invoiceNumber');
      if (!isDup) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

async function createInvoiceOnce(input) {
  const {
    userId, orderId = null, subscriptionId = null, title, description = null,
    subtotal = 0, discount = 0, tax = 0, total = 0, dueDate, notes = null,
    status = 'SENT',
  } = input;

  const due = dueDate ? new Date(dueDate) : new Date(Date.now() + 7 * 86400000);

  return prisma.invoice.create({
    data: {
      invoiceNumber: await nextInvoiceNumber(),
      userId,
      orderId,
      subscriptionId,
      title,
      description,
      subtotal: Number(subtotal),
      discount: Number(discount),
      tax: Number(tax),
      total: Number(total),
      dueDate: due,
      notes,
      status,
    },
  });
}

/**
 * Public entry point. Retries on an invoiceNumber collision so a concurrent
 * write can never fail the caller's request.
 */
function createInvoice(input) {
  return createInvoiceWithNumberRetry(input);
}

/** Convenience: raise the invoice that matches a freshly placed order. */
async function createInvoiceForOrder(order) {
  const balance = Math.max(0, Number(order.total) - Number(order.paidAmount || 0));
  if (balance <= 0) return null;
  return createInvoice({
    userId: order.userId,
    orderId: order.id,
    title: `Website build — ${order.projectName}`,
    description: `Order ${order.orderNumber}`,
    subtotal: order.subtotal,
    discount: order.discount,
    tax: order.tax,
    total: order.total,
    dueDate: new Date(Date.now() + 7 * 86400000),
    status: 'SENT',
  });
}

/** Convenience: raise a renewal invoice for a subscription period. */
async function createInvoiceForSubscription(subscription, quote) {
  return createInvoice({
    userId: subscription.userId,
    subscriptionId: subscription.id,
    title: `${subscription.planName} — ${subscription.billingCycle.toLowerCase()} renewal`,
    description: `Subscription ${subscription.subscriptionNumber}, period ending ${fmtDate(subscription.currentPeriodEnd)}`,
    subtotal: quote.subtotal,
    discount: quote.discount,
    tax: quote.tax,
    total: quote.total,
    dueDate: subscription.currentPeriodEnd,
    status: 'SENT',
  });
}

/**
 * Recompute invoice status and amountPaid from its payments.
 * Called after any payment is created, verified, or refunded.
 */
async function recalculate(invoiceId) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { payments: true },
  });
  if (!invoice) return null;

  const paid = invoice.payments
    .filter((p) => p.status === 'SUCCESS')
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const total = Number(invoice.total);
  let status = invoice.status;

  if (invoice.status !== 'VOID' && invoice.status !== 'DRAFT') {
    if (paid <= 0) {
      status = invoice.dueDate < new Date() ? 'OVERDUE' : 'SENT';
    } else if (paid >= total) {
      status = 'PAID';
    } else {
      status = 'PARTIALLY_PAID';
    }
  }

  return prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: paid,
      status,
      paidAt: status === 'PAID' ? invoice.paidAt || new Date() : null,
    },
  });
}

/** Mark overdue invoices that have passed their due date. */
async function sweepOverdue() {
  const result = await prisma.invoice.updateMany({
    where: {
      status: { in: ['SENT', 'PARTIALLY_PAID'] },
      dueDate: { lt: new Date() },
    },
    data: { status: 'OVERDUE' },
  });
  return result.count;
}

function decorate(invoice) {
  if (!invoice) return invoice;
  return {
    ...invoice,
    balance: Math.max(0, Number(invoice.total) - Number(invoice.amountPaid || 0)),
    daysUntilDue: daysUntil(invoice.dueDate),
    dueLabel: fmtDate(invoice.dueDate),
    issueLabel: fmtDate(invoice.issueDate),
  };
}

/** Monthly invoice/revenue series for the admin reports page. */
async function monthlySeries(months = 12) {
  const series = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);

    const [invoiced, collected, orders] = await Promise.all([
      prisma.invoice.aggregate({
        where: { issueDate: { gte: start, lte: end }, status: { notIn: ['VOID', 'DRAFT'] } },
        _sum: { total: true },
      }),
      prisma.payment.aggregate({
        where: { createdAt: { gte: start, lte: end }, status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      prisma.order.count({ where: { createdAt: { gte: start, lte: end } } }),
    ]);

    series.push({
      label: start.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      month: start.getMonth() + 1,
      year: start.getFullYear(),
      invoiced: invoiced._sum.total || 0,
      collected: collected._sum.amount || 0,
      orders,
    });
  }

  return series;
}

module.exports = {
  nextInvoiceNumber, createInvoice, createInvoiceForOrder,
  createInvoiceForSubscription, recalculate, sweepOverdue, decorate, monthlySeries,
};
