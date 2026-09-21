'use strict';

const express = require('express');

const prisma = require('../../config/prisma');
const subscriptionService = require('../../services/subscription.service');
const pricing = require('../../services/pricing.service');
const invoiceService = require('../../services/invoice.service');
const audit = require('../../services/audit.service');
const mailer = require('../../services/mailer.service');
const { requirePermission } = require('../../middleware/auth');
const { BILLING_CYCLE, SUBSCRIPTION_STATUS, SUPPORT_ADDONS } = require('../../config/constants');

const router = express.Router();

// ---------------------------------------------------------------
// GET /admin/subscriptions
// ---------------------------------------------------------------
router.get('/', requirePermission('subscriptions'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 25;
    const { status, q } = req.query;

    const where = {};
    if (status) where.status = String(status);
    if (q) {
      where.OR = [
        { subscriptionNumber: { contains: String(q) } },
        { planName: { contains: String(q) } },
        { user: { email: { contains: String(q) } } },
        { user: { name: { contains: String(q) } } },
      ];
    }

    const [subscriptions, total, statusGroups, mrrRows, renewals] = await Promise.all([
      prisma.subscription.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          package: true,
          addons: true,
        },
        orderBy: { currentPeriodEnd: 'asc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.subscription.count({ where }),
      prisma.subscription.groupBy({ by: ['status'], _count: true }),
      prisma.subscription.findMany({ where: { status: 'ACTIVE' }, select: { amount: true, billingCycle: true } }),
      subscriptionService.renewalsDue(14),
    ]);

    const cycleMonths = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };
    const mrr = mrrRows.reduce((sum, s) => sum + Number(s.amount) / (cycleMonths[s.billingCycle] || 1), 0);

    res.render('admin/subscriptions/index', {
      title: 'Subscriptions',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'subscriptions',
      metaTitle: 'Subscription management — WooHelperPro admin',
      subscriptions: subscriptions.map(subscriptionService.decorate),
      statusCounts: Object.fromEntries(statusGroups.map((g) => [g.status, g._count])),
      subscriptionStatuses: SUBSCRIPTION_STATUS,
      filters: { status: status || '', q: q || '' },
      pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
      mrr: Math.round(mrr),
      arr: Math.round(mrr * 12),
      renewals,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/subscriptions/new — put a customer on a recurring plan
// ---------------------------------------------------------------
router.get('/new', requirePermission('subscriptions'), async (req, res, next) => {
  try {
    const [customers, packages] = await Promise.all([
      prisma.user.findMany({
        where: { role: 'CUSTOMER' },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      }),
      prisma.package.findMany({
        where: { isActive: true, isRecurring: true },
        orderBy: { monthlyPrice: 'asc' },
      }),
    ]);

    res.render('admin/subscriptions/form', {
      title: 'New subscription',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'subscriptions',
      metaTitle: 'New subscription — WooHelperPro admin',
      customers,
      packages,
      cycles: BILLING_CYCLE,
      addonCatalog: SUPPORT_ADDONS,
      preselect: req.query.userId || '',
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/', requirePermission('subscriptions'), async (req, res, next) => {
  try {
    const {
      userId = '', packageId = '', planName = '', billingCycle = 'MONTHLY',
      amount = 0, setupFee = 0, discountPercent = 0, trialDays = 0, notes = '',
      addons = [],
    } = req.body;

    if (!userId) {
      req.flash('error', 'Select a customer.');
      return res.redirect('/admin/subscriptions/new');
    }

    const customer = await prisma.user.findUnique({ where: { id: userId } });
    if (!customer) {
      req.flash('error', 'Customer not found.');
      return res.redirect('/admin/subscriptions/new');
    }

    let resolvedPlanName = String(planName).trim();
    let resolvedAmount = Number(amount) || 0;

    // Deriving the amount from the package removes the most common data-entry
    // mistake: a plan billed at the wrong price.
    if (packageId) {
      const pkg = await prisma.package.findUnique({ where: { id: packageId } });
      if (pkg) {
        resolvedPlanName = resolvedPlanName || pkg.name;
        if (!resolvedAmount) {
          resolvedAmount = billingCycle === 'YEARLY' ? pkg.yearlyPrice : pkg.monthlyPrice;
        }
      }
    }

    if (!resolvedPlanName || resolvedAmount <= 0) {
      req.flash('error', 'Provide a plan name and a billing amount greater than zero.');
      return res.redirect('/admin/subscriptions/new');
    }

    const subscription = await subscriptionService.createSubscription({
      userId,
      packageId: packageId || null,
      planName: resolvedPlanName,
      billingCycle: BILLING_CYCLE[billingCycle] ? billingCycle : 'MONTHLY',
      amount: resolvedAmount,
      setupFee: Number(setupFee) || 0,
      discountPercent: Number(discountPercent) || 0,
      trialDays: Number(trialDays) || 0,
      notes: String(notes).trim() || null,
    });

    // Optional add-ons selected at creation time.
    const addonList = Array.isArray(addons) ? addons : [addons].filter(Boolean);
    for (const addonName of addonList) {
      const catalogEntry = SUPPORT_ADDONS.find((a) => a.name === addonName);
      if (catalogEntry) {
        await prisma.subscriptionAddon.create({
          data: {
            subscriptionId: subscription.id,
            name: catalogEntry.name,
            nameBn: catalogEntry.nameBn,
            price: catalogEntry.price,
            billingCycle: catalogEntry.cycle === 'ONE_TIME' ? 'MONTHLY' : catalogEntry.cycle,
            quantity: 1,
          },
        });
      }
    }

    await audit.log(req, 'subscription.created', {
      entityType: 'Subscription',
      entityId: subscription.id,
      detail: `${subscription.subscriptionNumber} — ${resolvedPlanName} ৳${resolvedAmount}/${billingCycle}`,
    });

    // Raise the first invoice so the customer can pay immediately.
    const quote = await pricing.quoteRenewal(subscription);
    const invoice = await invoiceService.createInvoiceForSubscription(subscription, quote);

    if (customer.email) {
      mailer.notify('invoice', [invoice], { to: customer.email }).catch(() => {});
    }

    req.flash('success', `Subscription ${subscription.subscriptionNumber} created and the first invoice issued.`);
    return res.redirect(`/admin/subscriptions/${subscription.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/subscriptions/:id
// ---------------------------------------------------------------
router.get('/:id', requirePermission('subscriptions'), async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { id: req.params.id },
      include: {
        user: true,
        package: true,
        addons: true,
        invoices: { include: { payments: true }, orderBy: { issueDate: 'desc' } },
      },
    });

    if (!subscription) return res.status(404).render('errors/404', { title: 'Subscription not found' });

    const quote = await pricing.quoteRenewal(subscription);

    res.render('admin/subscriptions/detail', {
      title: subscription.subscriptionNumber,
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'subscriptions',
      metaTitle: `${subscription.subscriptionNumber} — WooHelperPro admin`,
      subscription: subscriptionService.decorate(subscription),
      quote,
      subscriptionStatuses: SUBSCRIPTION_STATUS,
      addonCatalog: SUPPORT_ADDONS,
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/subscriptions/:id/provision — website handover details
// ---------------------------------------------------------------
//
// Staff fill this in once the site is built. The customer sees it on their
// dashboard; it is deliberately NOT emailed, because the admin-panel password
// would then sit in plain text in an inbox indefinitely.
router.post('/:id/provision', requirePermission('subscriptions'), async (req, res, next) => {
  try {
    const str = (k) => String(req.body[k] || '').trim();

    const existing = await prisma.subscription.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      req.flash('error', 'That subscription no longer exists.');
      return res.redirect('/admin/subscriptions');
    }

    const siteUrl = str('provisionedSiteUrl');
    const adminUrl = str('provisionedAdminUrl');

    // Only accept http(s). A javascript: URL here would be rendered into an
    // anchor on the customer dashboard, which is a stored-XSS vector.
    for (const [label, value] of [['Website URL', siteUrl], ['Admin panel URL', adminUrl]]) {
      if (value && !/^https?:\/\//i.test(value)) {
        req.flash('error', `${label} must start with http:// or https://`);
        return res.redirect(`/admin/subscriptions/${req.params.id}`);
      }
    }

    // Clearing every field means "withdraw the handover", which should also clear
    // the timestamp so the dashboard stops claiming it was delivered.
    const cleared = !siteUrl && !adminUrl && !str('provisionedUsername') && !str('provisionedPassword');

    await prisma.subscription.update({
      where: { id: req.params.id },
      data: {
        provisionedSiteUrl: siteUrl || null,
        provisionedAdminUrl: adminUrl || null,
        provisionedUsername: str('provisionedUsername') || null,
        // Blank password means "keep the stored one" -- the form never echoes it
        // back, so treating blank as a clear would wipe it on every unrelated save.
        provisionedPassword: str('provisionedPassword') || existing.provisionedPassword || null,
        provisionedNotes: str('provisionedNotes') || null,
        provisionedAt: cleared ? null : (existing.provisionedAt || new Date()),
        provisionedById: cleared ? null : (req.user ? req.user.id : null),
      },
    });

    await audit.log(req, 'subscription.provisioned', {
      entityType: 'Subscription',
      entityId: req.params.id,
      detail: cleared ? 'Handover details cleared' : `Site: ${siteUrl || '(none)'}`,
    });

    req.flash('success', cleared
      ? 'Handover details cleared. The customer no longer sees them.'
      : 'Website details saved. The customer can now see them on their dashboard.');
    return res.redirect(`/admin/subscriptions/${req.params.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/subscriptions/:id/action — pause / resume / cancel / expire
// ---------------------------------------------------------------
router.post('/:id/action', requirePermission('subscriptions'), async (req, res, next) => {
  try {
    const action = String(req.body.action || '').toUpperCase();
    const reason = String(req.body.reason || '').trim();

    const subscription = await prisma.subscription.findUnique({ where: { id: req.params.id } });
    if (!subscription) {
      req.flash('error', 'Subscription not found.');
      return res.redirect('/admin/subscriptions');
    }

    switch (action) {
      case 'PAUSE':
        await subscriptionService.pause(subscription.id, reason);
        break;
      case 'RESUME':
        await subscriptionService.resume(subscription.id);
        break;
      case 'CANCEL':
        await subscriptionService.cancel(subscription.id, reason);
        break;
      case 'EXPIRE':
        await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'EXPIRED', autoRenew: false } });
        break;
      case 'MARK_PAID':
        // Manual reconciliation: roll the period forward without a gateway payment.
        await subscriptionService.advancePeriod(subscription, subscription.currentPeriodEnd);
        break;
      default:
        req.flash('error', 'Unknown action.');
        return res.redirect(`/admin/subscriptions/${subscription.id}`);
    }

    await audit.log(req, `subscription.${action.toLowerCase()}`, {
      entityType: 'Subscription',
      entityId: subscription.id,
      detail: `${subscription.subscriptionNumber}${reason ? ` — ${reason}` : ''}`,
    });

    req.flash('success', `Subscription ${action.toLowerCase().replace('_', ' ')} applied.`);
    return res.redirect(`/admin/subscriptions/${subscription.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/subscriptions/:id/invoice — bill the next period
// ---------------------------------------------------------------
router.post('/:id/invoice', requirePermission('subscriptions'), async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.findUnique({ where: { id: req.params.id } });
    if (!subscription) {
      req.flash('error', 'Subscription not found.');
      return res.redirect('/admin/subscriptions');
    }

    const quote = await pricing.quoteRenewal(subscription);
    const invoice = await invoiceService.createInvoiceForSubscription(subscription, quote);

    await audit.log(req, 'invoice.created', {
      entityType: 'Invoice',
      entityId: invoice.id,
      detail: `${invoice.invoiceNumber} — renewal for ${subscription.subscriptionNumber}`,
    });

    req.flash('success', `Renewal invoice ${invoice.invoiceNumber} created for ৳${quote.total}.`);
    return res.redirect(`/admin/subscriptions/${subscription.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/subscriptions/:id/addons — attach an add-on
// ---------------------------------------------------------------
router.post('/:id/addons', requirePermission('subscriptions'), async (req, res, next) => {
  try {
    const catalogEntry = SUPPORT_ADDONS.find((a) => a.name === String(req.body.name));

    const name = catalogEntry ? catalogEntry.name : String(req.body.name || '').trim();
    const price = catalogEntry ? catalogEntry.price : Number(req.body.price) || 0;

    if (!name || price <= 0) {
      req.flash('error', 'Choose an add-on from the catalogue or provide a name and a price.');
      return res.redirect(`/admin/subscriptions/${req.params.id}`);
    }

    await prisma.subscriptionAddon.create({
      data: {
        subscriptionId: req.params.id,
        name,
        nameBn: catalogEntry ? catalogEntry.nameBn : null,
        price,
        billingCycle: catalogEntry && catalogEntry.cycle === 'ONE_TIME' ? 'MONTHLY' : (catalogEntry?.cycle || 'MONTHLY'),
        quantity: Number(req.body.quantity) || 1,
      },
    });

    await audit.log(req, 'subscription.addon_added', {
      entityType: 'Subscription',
      entityId: req.params.id,
      detail: `${name} @ ৳${price}`,
    });

    req.flash('success', `${name} added to the subscription.`);
    return res.redirect(`/admin/subscriptions/${req.params.id}`);
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/addons/:addonId/delete', requirePermission('subscriptions'), async (req, res, next) => {
  try {
    await prisma.subscriptionAddon.delete({ where: { id: req.params.addonId } });
    await audit.log(req, 'subscription.addon_removed', {
      entityType: 'Subscription',
      entityId: req.params.id,
      detail: `Addon ${req.params.addonId} removed`,
    });

    req.flash('success', 'Add-on removed.');
    return res.redirect(`/admin/subscriptions/${req.params.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/subscriptions/run-billing — manual sweep trigger
// ---------------------------------------------------------------
router.post('/run-billing', requirePermission('subscriptions'), async (req, res, next) => {
  try {
    const dryRun = req.body.dryRun === 'on';
    const summary = await subscriptionService.runBillingSweep({ dryRun });
    const overdueInvoices = dryRun ? 0 : await invoiceService.sweepOverdue();

    await audit.log(req, 'subscription.billing_sweep', {
      detail: `dryRun=${dryRun}, pastDue=${summary.markedPastDue.length}, expired=${summary.markedExpired.length}, trialActivated=${summary.activatedFromTrial.length}, overdueInvoices=${overdueInvoices}`,
    });

    req.flash(
      'success',
      dryRun
        ? `Dry run: ${summary.markedPastDue.length} would move to past due, ${summary.markedExpired.length} would expire.`
        : `Billing sweep complete: ${summary.markedPastDue.length} past due, ${summary.markedExpired.length} expired, ${summary.activatedFromTrial.length} trials activated, ${overdueInvoices} invoices marked overdue.`,
    );
    return res.redirect('/admin/subscriptions');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
