'use strict';

const express = require('express');

const prisma = require('../../config/prisma');
const paymentService = require('../../services/payment.service');
const invoiceService = require('../../services/invoice.service');
const audit = require('../../services/audit.service');
const mailer = require('../../services/mailer.service');
const { requirePermission } = require('../../middleware/auth');
const { PAYMENT_METHOD, INVOICE_STATUS, PAYMENT_STATUS } = require('../../config/constants');

const router = express.Router();

// ---------------------------------------------------------------
// GET /admin/invoices
// ---------------------------------------------------------------
router.get('/invoices', requirePermission('invoices'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 25;
    const { status, q } = req.query;

    const where = {};
    if (status) where.status = String(status);
    if (q) {
      where.OR = [
        { invoiceNumber: { contains: String(q) } },
        { title: { contains: String(q) } },
        { user: { email: { contains: String(q) } } },
        { user: { name: { contains: String(q) } } },
      ];
    }

    const [invoices, total, statusGroups, totals] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
          order: { select: { orderNumber: true } },
          subscription: { select: { subscriptionNumber: true } },
        },
        orderBy: { issueDate: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.invoice.count({ where }),
      prisma.invoice.groupBy({ by: ['status'], _count: true }),
      prisma.invoice.aggregate({
        where: { status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
        _sum: { total: true, amountPaid: true },
      }),
    ]);

    res.render('admin/invoices/index', {
      title: 'Invoices',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'invoices',
      metaTitle: 'Invoices — WooHelperPro admin',
      invoices: invoices.map(invoiceService.decorate),
      statusCounts: Object.fromEntries(statusGroups.map((g) => [g.status, g._count])),
      invoiceStatuses: INVOICE_STATUS,
      filters: { status: status || '', q: q || '' },
      pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
      outstanding: Math.max(0, (totals._sum.total || 0) - (totals._sum.amountPaid || 0)),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/invoices/:id
// ---------------------------------------------------------------
router.get('/invoices/:id', requirePermission('invoices'), async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        user: true,
        order: true,
        subscription: true,
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!invoice) return res.status(404).render('errors/404', { title: 'Invoice not found' });

    res.render('admin/invoices/detail', {
      title: invoice.invoiceNumber,
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'invoices',
      metaTitle: `${invoice.invoiceNumber} — WooHelperPro admin`,
      invoice: invoiceService.decorate(invoice),
      invoiceStatuses: INVOICE_STATUS,
      paymentMethods: PAYMENT_METHOD,
      settings: res.locals.settings,
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/invoices/:id/status
// ---------------------------------------------------------------
router.post('/invoices/:id/status', requirePermission('invoices'), async (req, res, next) => {
  try {
    const status = String(req.body.status || '').toUpperCase();
    if (!INVOICE_STATUS[status]) {
      req.flash('error', 'Unknown invoice status.');
      return res.redirect(`/admin/invoices/${req.params.id}`);
    }

    await prisma.invoice.update({ where: { id: req.params.id }, data: { status } });
    await audit.log(req, 'invoice.status_changed', {
      entityType: 'Invoice',
      entityId: req.params.id,
      detail: `-> ${status}`,
    });

    req.flash('success', `Invoice marked ${status.toLowerCase()}.`);
    return res.redirect(`/admin/invoices/${req.params.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/invoices/:id/resend — re-send the invoice email
// ---------------------------------------------------------------
router.post('/invoices/:id/resend', requirePermission('invoices'), async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    });

    if (!invoice) {
      req.flash('error', 'Invoice not found.');
      return res.redirect('/admin/invoices');
    }

    const result = await mailer.send({ to: invoice.user.email, ...mailer.templates.invoice(invoice) });

    await audit.log(req, 'invoice.resent', { entityType: 'Invoice', entityId: invoice.id });

    req.flash(
      result.queued ? 'success' : 'warning',
      result.queued
        ? `Invoice emailed to ${invoice.user.email}.`
        : 'SMTP is not configured, so the email was written to the server log instead. Ask the customer to check their dashboard.',
    );
    return res.redirect(`/admin/invoices/${invoice.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/payments
// ---------------------------------------------------------------
router.get('/payments', requirePermission('payments'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 25;
    const { status, method, q } = req.query;

    const where = {};
    if (status) where.status = String(status);
    if (method) where.method = String(method);
    if (q) {
      where.OR = [
        { reference: { contains: String(q) } },
        { transactionId: { contains: String(q) } },
        { senderNumber: { contains: String(q) } },
        { user: { email: { contains: String(q) } } },
      ];
    }

    const [payments, total, summary] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          invoice: { select: { id: true, invoiceNumber: true, total: true } },
          order: { select: { id: true, orderNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.payment.count({ where }),
      paymentService.summary(),
    ]);

    res.render('admin/payments/index', {
      title: 'Payments',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'payments',
      metaTitle: 'Payments — WooHelperPro admin',
      payments,
      summary,
      paymentMethods: PAYMENT_METHOD,
      paymentStatuses: PAYMENT_STATUS,
      filters: { status: status || '', method: method || '', q: q || '' },
      pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/payments/:id/verify
// ---------------------------------------------------------------
router.post('/payments/:id/verify', requirePermission('payments'), async (req, res, next) => {
  try {
    const payment = await paymentService.verify(req.params.id, { actorId: req.user.id, actor: req });

    await audit.log(req, 'payment.verified_manually', {
      entityType: 'Payment',
      entityId: payment.id,
      detail: `${payment.reference} — ৳${payment.amount}`,
    });

    const customer = await prisma.user.findUnique({ where: { id: payment.userId } });
    if (customer?.email) {
      mailer.send({ to: customer.email, ...mailer.templates.paymentReceived(payment) }).catch(() => {});
    }

    req.flash('success', `Payment ${payment.reference} verified. Order and invoice balances updated.`);
    return res.redirect(req.get('referer') || '/admin/payments');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/payments/:id/reject
// ---------------------------------------------------------------
router.post('/payments/:id/reject', requirePermission('payments'), async (req, res, next) => {
  try {
    const reason = String(req.body.reason || '').trim() || 'Rejected by accounts team.';
    await paymentService.reject(req.params.id, reason);

    await audit.log(req, 'payment.rejected', {
      entityType: 'Payment',
      entityId: req.params.id,
      detail: reason,
    });

    req.flash('warning', 'Payment marked as failed. The customer can re-submit with a correct transaction ID.');
    return res.redirect(req.get('referer') || '/admin/payments');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/payments/:id/refund
// ---------------------------------------------------------------
router.post('/payments/:id/refund', requirePermission('payments'), async (req, res, next) => {
  try {
    const reason = String(req.body.reason || '').trim() || 'Refunded.';
    await paymentService.refund(req.params.id, reason);

    await audit.log(req, 'payment.refunded', {
      entityType: 'Payment',
      entityId: req.params.id,
      detail: reason,
    });

    req.flash('success', 'Payment marked as refunded. Invoice and order balances were recalculated.');
    return res.redirect(req.get('referer') || '/admin/payments');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/payments/manual — record a bank/cash receipt
// ---------------------------------------------------------------
router.post('/payments/manual', requirePermission('payments'), async (req, res, next) => {
  try {
    const {
      invoiceId = '', amount = 0, method = 'BANK_TRANSFER', transactionId = '',
      senderNumber = '', paidAt = '', autoVerify = 'on',
    } = req.body;

    if (!invoiceId) {
      req.flash('error', 'Select an invoice to record this payment against.');
      return res.redirect('/admin/payments');
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      req.flash('error', 'Invoice not found.');
      return res.redirect('/admin/payments');
    }

    const value = Number(amount) || 0;
    if (value <= 0) {
      req.flash('error', 'Enter a payment amount greater than zero.');
      return res.redirect(`/admin/invoices/${invoiceId}`);
    }

    const methodKey = PAYMENT_METHOD[String(method).toUpperCase()] ? String(method).toUpperCase() : 'MANUAL';

    const payment = await paymentService.createPayment({
      userId: invoice.userId,
      invoiceId: invoice.id,
      orderId: invoice.orderId,
      amount: value,
      method: methodKey,
      transactionId: String(transactionId).trim() || null,
      senderNumber: String(senderNumber).trim() || null,
      paidAt: paidAt ? new Date(paidAt) : new Date(),
      status: 'PENDING',
    });

    // Bank/cash receipts entered by staff are trusted and verified immediately.
    if (autoVerify === 'on') {
      await paymentService.verify(payment.id, { actorId: req.user.id, actor: req });
    }

    await audit.log(req, 'payment.recorded_manually', {
      entityType: 'Payment',
      entityId: payment.id,
      detail: `৳${value} via ${methodKey} against ${invoice.invoiceNumber}`,
    });

    req.flash('success', `Payment of ৳${value} recorded against ${invoice.invoiceNumber}.`);
    return res.redirect(`/admin/invoices/${invoice.id}`);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
