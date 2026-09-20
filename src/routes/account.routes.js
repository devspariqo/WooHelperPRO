'use strict';

const express = require('express');

const prisma = require('../config/prisma');
const orderService = require('../services/order.service');
const subscriptionService = require('../services/subscription.service');
const invoiceService = require('../services/invoice.service');
const paymentService = require('../services/payment.service');
const pricing = require('../services/pricing.service');
const paymentGateway = require('../services/paymentGateway.service');
const audit = require('../services/audit.service');
const ticketService = require('../services/ticket.service');
const ids = require('../utils/ids');
const sec = require('../utils/security');
const { parse } = require('../utils/json');
const { requireCustomer } = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimit');
const { DISTRICTS, TICKET_CATEGORIES, SUPPORT_ADDONS } = require('../config/constants');

const router = express.Router();

// Every route in this file requires a signed-in customer.
router.use(requireCustomer);

// ---------------------------------------------------------------
// GET /account — dashboard
// ---------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [orders, subscriptions, invoices, tickets, cards, renewals] = await Promise.all([
      prisma.order.findMany({
        where: { userId },
        include: { package: true, project: { include: { milestones: { orderBy: { sortOrder: 'asc' } } } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.subscription.findMany({
        where: { userId },
        include: { package: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.invoice.findMany({
        where: { userId },
        orderBy: { issueDate: 'desc' },
        take: 5,
      }),
      prisma.ticket.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 3 }),
      Promise.all([
        prisma.order.count({ where: { userId } }),
        prisma.order.count({ where: { userId, status: { in: ['COMPLETED', 'DELIVERED'] } } }),
        prisma.subscription.count({ where: { userId, status: 'ACTIVE' } }),
        prisma.invoice.aggregate({
          where: { userId, status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
          _sum: { total: true, amountPaid: true },
        }),
      ]),
      subscriptionService.renewalsDue(30).then((list) => list.filter((s) => s.userId === userId)),
    ]);

    const [orderCount, completedCount, activeSubs, outstanding] = cards;

    res.render('account/dashboard', {
      title: 'Dashboard',
      layout: 'layouts/dashboard',
      bodyClass: 'account-page',
      panel: 'account',
      active: 'dashboard',
      metaTitle: 'My dashboard — WooHelperPro',
      orders: orders.map(orderService.decorate),
      subscriptions: subscriptions.map(subscriptionService.decorate),
      invoices: invoices.map(invoiceService.decorate),
      tickets,
      renewals,
      stats: {
        orderCount,
        completedCount,
        activeSubs,
        outstanding: Math.max(0, (outstanding._sum.total || 0) - (outstanding._sum.amountPaid || 0)),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /account/orders
// ---------------------------------------------------------------
router.get('/orders', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const where = { userId: req.user.id };
    if (status) where.status = status;

    const orders = await prisma.order.findMany({
      where,
      include: { package: true, project: true },
      orderBy: { createdAt: 'desc' },
    });

    res.render('account/orders', {
      title: 'My orders',
      layout: 'layouts/dashboard',
      bodyClass: 'account-page',
      panel: 'account',
      active: 'orders',
      metaTitle: 'My orders — WooHelperPro',
      orders: orders.map(orderService.decorate),
      activeStatus: status || '',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /account/orders/:id — order detail with live project tracker
// ---------------------------------------------------------------
router.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        package: { include: { service: true } },
        invoices: { include: { payments: true }, orderBy: { issueDate: 'desc' } },
        payments: { orderBy: { createdAt: 'desc' } },
        project: { include: { milestones: { orderBy: { sortOrder: 'asc' } } } },
      },
    });

    if (!order) return res.status(404).render('errors/404', { title: 'Order not found' });

    res.render('account/order-detail', {
      title: `Order ${order.orderNumber}`,
      layout: 'layouts/dashboard',
      bodyClass: 'account-page',
      panel: 'account',
      active: 'orders',
      metaTitle: `Order ${order.orderNumber} — WooHelperPro`,
      order: orderService.decorate(order),
      selectedPages: parse(order.selectedPages),
      nextStatuses: orderService.allowedNext(order.status).filter((s) => ['CANCELLED'].includes(s)),
      gateways: paymentGateway.listGateways(),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /account/orders/:id/cancel — customer-initiated cancellation
// ---------------------------------------------------------------
router.post('/orders/:id/cancel', async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!order) {
      req.flash('error', 'Order not found.');
      return res.redirect('/account/orders');
    }

    // Once production has started, only staff can cancel — work has been paid for.
    if (!['PENDING', 'AWAITING_PAYMENT', 'IN_REVIEW'].includes(order.status)) {
      req.flash('error', 'Production has already started. Please open a support ticket to request a cancellation.');
      return res.redirect(`/account/orders/${order.id}`);
    }

    await orderService.updateStatus(order.id, 'CANCELLED', {
      note: `Cancelled by customer. Reason: ${String(req.body.reason || 'not provided')}`,
    });

    await audit.log(req, 'order.cancelled_by_customer', {
      entityType: 'Order',
      entityId: order.id,
      detail: `${order.orderNumber} — ${req.body.reason || 'no reason given'}`,
    });

    req.flash('success', 'Your order has been cancelled. Any payment made will be processed under our refund policy.');
    return res.redirect('/account/orders');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// GET /account/subscriptions
// ---------------------------------------------------------------
router.get('/subscriptions', async (req, res, next) => {
  try {
    const subscriptions = await prisma.subscription.findMany({
      where: { userId: req.user.id },
      include: {
        package: true,
        addons: true,
        invoices: { orderBy: { issueDate: 'desc' }, take: 6 },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.render('account/subscriptions', {
      title: 'My subscriptions',
      layout: 'layouts/dashboard',
      bodyClass: 'account-page',
      panel: 'account',
      active: 'subscriptions',
      metaTitle: 'My subscriptions — WooHelperPro',
      subscriptions: subscriptions.map(subscriptionService.decorate),
      addonCatalog: SUPPORT_ADDONS,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /account/subscriptions/:id
// ---------------------------------------------------------------
router.get('/subscriptions/:id', async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        package: true,
        addons: true,
        invoices: { include: { payments: true }, orderBy: { issueDate: 'desc' } },
      },
    });

    if (!subscription) return res.status(404).render('errors/404', { title: 'Subscription not found' });

    const quote = await pricing.quoteRenewal(subscription);

    res.render('account/subscription-detail', {
      title: subscription.planName,
      layout: 'layouts/dashboard',
      bodyClass: 'account-page',
      panel: 'account',
      active: 'subscriptions',
      metaTitle: `${subscription.planName} — WooHelperPro`,
      subscription: subscriptionService.decorate(subscription),
      quote,
      addonCatalog: SUPPORT_ADDONS,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /account/subscriptions/:id/auto-renew — toggle
// ---------------------------------------------------------------
router.post('/subscriptions/:id/auto-renew', async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!subscription) {
      req.flash('error', 'Subscription not found.');
      return res.redirect('/account/subscriptions');
    }

    const next = req.body.autoRenew === 'on' || req.body.autoRenew === 'true';
    await subscriptionService.setAutoRenew(subscription.id, next);

    await audit.log(req, 'subscription.auto_renew_changed', {
      entityType: 'Subscription',
      entityId: subscription.id,
      detail: `${subscription.subscriptionNumber} auto-renew set to ${next}`,
    });

    req.flash('success', next ? 'Auto-renew is now on.' : 'Auto-renew is now off. We will remind you before expiry.');
    return res.redirect(`/account/subscriptions/${subscription.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /account/subscriptions/:id/cancel
// ---------------------------------------------------------------
router.post('/subscriptions/:id/cancel', async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!subscription) {
      req.flash('error', 'Subscription not found.');
      return res.redirect('/account/subscriptions');
    }

    await subscriptionService.cancel(subscription.id, String(req.body.reason || 'Cancelled by customer'));

    await audit.log(req, 'subscription.cancelled_by_customer', {
      entityType: 'Subscription',
      entityId: subscription.id,
      detail: `${subscription.subscriptionNumber} — ${req.body.reason || 'no reason given'}`,
    });

    req.flash(
      'success',
      'Your subscription has been cancelled. Your website stays live until the end of the current paid period.',
    );
    return res.redirect('/account/subscriptions');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// GET /account/invoices
// ---------------------------------------------------------------
router.get('/invoices', async (req, res, next) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { userId: req.user.id },
      include: { order: true, subscription: true },
      orderBy: { issueDate: 'desc' },
    });

    res.render('account/invoices', {
      title: 'My invoices',
      layout: 'layouts/dashboard',
      bodyClass: 'account-page',
      panel: 'account',
      active: 'invoices',
      metaTitle: 'My invoices — WooHelperPro',
      invoices: invoices.map(invoiceService.decorate),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /account/invoices/:id — printable invoice + payment entry
// ---------------------------------------------------------------
router.get('/invoices/:id', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        order: true,
        subscription: true,
        payments: { orderBy: { createdAt: 'desc' } },
        user: { select: { name: true, email: true, phone: true, address: true, district: true, company: true } },
      },
    });

    if (!invoice) return res.status(404).render('errors/404', { title: 'Invoice not found' });

    res.render('account/invoice-detail', {
      title: `Invoice ${invoice.invoiceNumber}`,
      layout: 'layouts/dashboard',
      bodyClass: 'account-page',
      panel: 'account',
      active: 'invoices',
      metaTitle: `Invoice ${invoice.invoiceNumber} — WooHelperPro`,
      invoice: invoiceService.decorate(invoice),
      gateways: paymentGateway.listGateways(),
      settings: res.locals.settings,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /account/invoices/:id/pay — submit a wallet payment for verification
// ---------------------------------------------------------------
router.post('/invoices/:id/pay', paymentLimiter, async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!invoice) {
      req.flash('error', 'Invoice not found.');
      return res.redirect('/account/invoices');
    }

    const method = String(req.body.method || '').toUpperCase();
    const transactionId = String(req.body.transactionId || '').trim();
    const senderNumber = String(req.body.senderNumber || '').trim();
    const amount = Number(req.body.amount || 0);

    const gateway = paymentGateway.getGateway(method);
    if (!gateway) {
      req.flash('error', 'Choose a payment method.');
      return res.redirect(`/account/invoices/${invoice.id}`);
    }

    if (!transactionId) {
      req.flash('error', 'Enter the transaction ID from your payment confirmation SMS.');
      return res.redirect(`/account/invoices/${invoice.id}`);
    }

    const payable = Math.max(0, Number(invoice.total) - Number(invoice.amountPaid || 0));
    if (amount <= 0 || amount > payable + 0.01) {
      req.flash('error', `Enter an amount between ৳1 and ৳${payable.toLocaleString('en-BD')}.`);
      return res.redirect(`/account/invoices/${invoice.id}`);
    }

    const payment = await paymentService.submitManual({
      userId: req.user.id,
      invoiceId: invoice.id,
      orderId: invoice.orderId,
      amount,
      method,
      transactionId,
      senderNumber: senderNumber || null,
    });

    await audit.log(req, 'payment.submitted', {
      entityType: 'Payment',
      entityId: payment.id,
      detail: `${payment.reference} — ৳${amount} via ${method}, TrxID ${transactionId}`,
    });

    // Flag for the accounts team so verification does not sit unnoticed.
    // A ticket-number collision used to be swallowed here; log it instead of
    // failing silently, since an unverified payment is money at risk.
    await ticketService
      .createTicket({
        userId: req.user.id,
        subject: `Payment verification needed — ${invoice.invoiceNumber}`,
        message: `Customer submitted a ${method} payment of ৳${amount}.\nTransaction ID: ${transactionId}\nSender number: ${senderNumber || 'not provided'}\nInvoice: ${invoice.invoiceNumber}`,
        category: 'BILLING',
        priority: 'HIGH',
        status: 'OPEN',
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[payment-verify-ticket] could not raise ticket:', err && err.message);
      });

    req.flash(
      'success',
      `Payment submitted for verification (reference ${payment.reference}). We confirm wallet payments within 1 business hour.`,
    );
    return res.redirect(`/account/invoices/${invoice.id}`);
  } catch (err) {
    if (err.status === 409) {
      req.flash('error', err.message);
      return res.redirect(`/account/invoices/${invoice.id}`);
    }
    return next(err);
  }
});

// ---------------------------------------------------------------
// GET /account/payments
// ---------------------------------------------------------------
router.get('/payments', async (req, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { userId: req.user.id },
      include: { invoice: true, order: true },
      orderBy: { createdAt: 'desc' },
    });

    res.render('account/payments', {
      title: 'Payment history',
      layout: 'layouts/dashboard',
      bodyClass: 'account-page',
      panel: 'account',
      active: 'payments',
      metaTitle: 'Payment history — WooHelperPro',
      payments,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Support tickets
// ---------------------------------------------------------------
router.get('/tickets', async (req, res, next) => {
  try {
    const tickets = await prisma.ticket.findMany({
      where: { userId: req.user.id },
      include: { _count: { select: { replies: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.render('account/tickets', {
      title: 'Support tickets',
      layout: 'layouts/dashboard',
      bodyClass: 'account-page',
      panel: 'account',
      active: 'tickets',
      metaTitle: 'Support — WooHelperPro',
      tickets,
      categories: TICKET_CATEGORIES,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/tickets', async (req, res, next) => {
  try {
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();

    if (subject.length < 3 || message.length < 10) {
      req.flash('error', 'Give your ticket a subject and describe the issue in at least 10 characters.');
      return res.redirect('/account/tickets');
    }

    const ticket = await ticketService.createTicket({
      userId: req.user.id,
      subject,
      message,
      category: String(req.body.category || 'GENERAL').toUpperCase(),
      priority: String(req.body.priority || 'NORMAL').toUpperCase(),
      status: 'OPEN',
    });

    await audit.log(req, 'ticket.created', {
      entityType: 'Ticket',
      entityId: ticket.id,
      detail: `${ticket.ticketNumber} — ${subject}`,
    });

    req.flash('success', 'Ticket opened. Our support team replies within one business day.');
    return res.redirect(`/account/tickets/${ticket.id}`);
  } catch (err) {
    return next(err);
  }
});

router.get('/tickets/:id', async (req, res, next) => {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        replies: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { name: true, role: true, avatarUrl: true } } },
        },
      },
    });

    if (!ticket) return res.status(404).render('errors/404', { title: 'Ticket not found' });

    res.render('account/ticket-detail', {
      title: ticket.subject,
      layout: 'layouts/dashboard',
      bodyClass: 'account-page',
      panel: 'account',
      active: 'tickets',
      metaTitle: `${ticket.subject} — WooHelperPro`,
      ticket,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/tickets/:id/reply', async (req, res, next) => {
  try {
    const ticket = await prisma.ticket.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!ticket) {
      req.flash('error', 'Ticket not found.');
      return res.redirect('/account/tickets');
    }

    const body = String(req.body.body || '').trim();
    if (body.length < 2) {
      req.flash('error', 'Write a message before sending.');
      return res.redirect(`/account/tickets/${ticket.id}`);
    }

    await prisma.ticketReply.create({
      data: { ticketId: ticket.id, userId: req.user.id, body, isStaff: false },
    });

    // Customer replying reopens a resolved ticket and returns it to the queue.
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: ['RESOLVED', 'CLOSED', 'WAITING_CUSTOMER'].includes(ticket.status) ? 'OPEN' : 'IN_PROGRESS',
        updatedAt: new Date(),
      },
    });

    req.flash('success', 'Reply sent.');
    return res.redirect(`/account/tickets/${ticket.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// Profile
// ---------------------------------------------------------------
router.get('/profile', (req, res) => {
  res.render('account/profile', {
    title: 'My profile',
    layout: 'layouts/dashboard',
    bodyClass: 'account-page',
    panel: 'account',
    active: 'profile',
    metaTitle: 'My profile — WooHelperPro',
    districts: DISTRICTS,
  });
});

router.post('/profile', async (req, res, next) => {
  try {
    const { name = '', phone = '', company = '', district = '', address = '', designation = '' } = req.body;

    const normalizedPhone = phone ? sec.normalizeBdPhone(phone) : null;
    if (phone && !normalizedPhone) {
      req.flash('error', 'Enter a valid Bangladeshi mobile number.');
      return res.redirect('/account/profile');
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        name: String(name).trim() || req.user.name,
        phone: normalizedPhone,
        company: String(company).trim() || null,
        designation: String(designation).trim() || null,
        district: String(district).trim() || null,
        address: String(address).trim() || null,
      },
    });

    await audit.log(req, 'user.profile_updated', { entityType: 'User', entityId: req.user.id });

    req.flash('success', 'Profile updated.');
    return res.redirect('/account/profile');
  } catch (err) {
    return next(err);
  }
});

router.post('/profile/password', async (req, res, next) => {
  try {
    const { currentPassword = '', newPassword = '', confirmPassword = '' } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const ok = await sec.compare(currentPassword, user.passwordHash);

    if (!ok) {
      req.flash('error', 'Your current password is incorrect.');
      return res.redirect('/account/profile');
    }

    const check = sec.validatePassword(newPassword);
    if (!check.valid) {
      req.flash('error', check.errors.join(' '));
      return res.redirect('/account/profile');
    }
    if (newPassword !== confirmPassword) {
      req.flash('error', 'The two passwords do not match.');
      return res.redirect('/account/profile');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await sec.hash(newPassword) },
    });

    await audit.log(req, 'user.password_changed', { entityType: 'User', entityId: user.id });

    req.flash('success', 'Password changed.');
    return res.redirect('/account/profile');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
