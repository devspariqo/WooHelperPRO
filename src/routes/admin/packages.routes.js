'use strict';

const express = require('express');

const prisma = require('../../config/prisma');
const audit = require('../../services/audit.service');
const { fromLines, toLines, parse } = require('../../utils/json');
const { slugify } = require('../../utils/format');
const { requirePermission } = require('../../middleware/auth');
const { PACKAGE_TIER, BILLING_CYCLE } = require('../../config/constants');

const router = express.Router();

// ---------------------------------------------------------------
// GET /admin/packages
// ---------------------------------------------------------------
router.get('/', requirePermission('packages'), async (req, res, next) => {
  try {
    const packages = await prisma.package.findMany({
      include: {
        service: true,
        _count: { select: { orders: true, subscriptions: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
    });

    res.render('admin/packages/index', {
      title: 'Packages & plans',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'packages',
      metaTitle: 'Packages — WooHelperPro admin',
      packages: packages.map((p) => ({
        ...p,
        orderCount: p._count.orders,
        subCount: p._count.subscriptions,
      })),
      tiers: PACKAGE_TIER,
      cycles: BILLING_CYCLE,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/packages/new
// ---------------------------------------------------------------
router.get('/new', requirePermission('packages'), async (req, res, next) => {
  try {
    const services = await prisma.service.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: { title: 'asc' },
    });

    res.render('admin/packages/form', {
      title: 'Add package',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'packages',
      metaTitle: 'Add package — WooHelperPro admin',
      package: null,
      services,
      tiers: PACKAGE_TIER,
      cycles: BILLING_CYCLE,
      featureLines: '',
      featureBnLines: '',
      excludedLines: '',
      excludedBnLines: '',
    });
  } catch (err) {
    return next(err);
  }
});

function readPackageForm(body) {
  return {
    name: String(body.name || '').trim(),
    nameBn: String(body.nameBn || '').trim() || null,
    serviceId: body.serviceId || null,
    tier: PACKAGE_TIER[body.tier] ? body.tier : 'BASIC',
    tagline: String(body.tagline || '').trim() || null,
    imageUrl: String(body.imageUrl || '').trim() || null,
    taglineBn: String(body.taglineBn || '').trim() || null,
    price: Number(body.price) || 0,
    setupFee: Number(body.setupFee) || 0,
    monthlyPrice: Number(body.monthlyPrice) || 0,
    yearlyPrice: Number(body.yearlyPrice) || 0,
    discountPercent: Number(body.discountPercent) || 0,
    billingCycle: BILLING_CYCLE[body.billingCycle] ? body.billingCycle : 'ONE_TIME',
    features: fromLines(body.features),
    featuresBn: fromLines(body.featuresBn),
    excluded: fromLines(body.excluded),
    excludedBn: fromLines(body.excludedBn),
    revisions: Number(body.revisions) || 2,
    deliveryDays: Number(body.deliveryDays) || 7,
    supportMonths: Number(body.supportMonths) || 3,
    hostingMonths: Number(body.hostingMonths) || 0,
    pagesIncluded: Number(body.pagesIncluded) || 5,
    productsLimit: Number(body.productsLimit) || 0,
    staffLimit: Number(body.staffLimit) || 1,
    isPopular: body.isPopular === 'on',
    isActive: body.isActive !== 'off',
    isRecurring: body.isRecurring === 'on' || ['MONTHLY', 'YEARLY', 'QUARTERLY', 'HALF_YEARLY'].includes(body.billingCycle),
    sortOrder: Number(body.sortOrder) || 0,
  };
}

router.post('/', requirePermission('packages'), async (req, res, next) => {
  try {
    const data = readPackageForm(req.body);

    if (data.name.length < 2) {
      req.flash('error', 'Enter a package name.');
      return res.redirect('/admin/packages/new');
    }

    const baseSlug = slugify(req.body.slug || data.name);
    let slug = baseSlug;
    let suffix = 1;
    while (await prisma.package.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const pkg = await prisma.package.create({ data: { ...data, slug } });

    await audit.log(req, 'package.created', {
      entityType: 'Package',
      entityId: pkg.id,
      detail: `${pkg.name} — ৳${pkg.price}`,
    });

    req.flash('success', `Package "${pkg.name}" created and is now orderable.`);
    return res.redirect('/admin/packages');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/packages/:id/edit
// ---------------------------------------------------------------
router.get('/:id/edit', requirePermission('packages'), async (req, res, next) => {
  try {
    const [pkg, services] = await Promise.all([
      prisma.package.findUnique({ where: { id: req.params.id } }),
      prisma.service.findMany({ where: { status: { not: 'ARCHIVED' } }, orderBy: { title: 'asc' } }),
    ]);

    if (!pkg) return res.status(404).render('errors/404', { title: 'Package not found' });

    res.render('admin/packages/form', {
      title: `Edit ${pkg.name}`,
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'packages',
      metaTitle: `Edit ${pkg.name} — WooHelperPro admin`,
      package: pkg,
      services,
      tiers: PACKAGE_TIER,
      cycles: BILLING_CYCLE,
      featureLines: toLines(pkg.features),
      featureBnLines: toLines(pkg.featuresBn),
      excludedLines: toLines(pkg.excluded),
      excludedBnLines: toLines(pkg.excludedBn),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id', requirePermission('packages'), async (req, res, next) => {
  try {
    const existing = await prisma.package.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).render('errors/404', { title: 'Package not found' });

    const data = readPackageForm(req.body);

    if (req.body.regenerateSlug === 'on' && data.name !== existing.name) {
      let slug = slugify(data.name);
      let suffix = 1;
      while (await prisma.package.findFirst({ where: { slug, id: { not: existing.id } } })) {
        slug = `${slugify(data.name)}-${suffix++}`;
      }
      data.slug = slug;
    }

    await prisma.package.update({ where: { id: existing.id }, data });

    await audit.log(req, 'package.updated', {
      entityType: 'Package',
      entityId: existing.id,
      detail: `${data.name} — ৳${data.price}`,
    });

    req.flash('success', 'Package updated.');
    return res.redirect('/admin/packages');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/packages/:id/toggle — quick activate/deactivate
// ---------------------------------------------------------------
router.post('/:id/toggle', requirePermission('packages'), async (req, res, next) => {
  try {
    const pkg = await prisma.package.findUnique({ where: { id: req.params.id } });
    if (!pkg) {
      req.flash('error', 'Package not found.');
      return res.redirect('/admin/packages');
    }

    const updated = await prisma.package.update({
      where: { id: pkg.id },
      data: { isActive: !pkg.isActive },
    });

    await audit.log(req, 'package.toggled', {
      entityType: 'Package',
      entityId: pkg.id,
      detail: `${pkg.name} -> ${updated.isActive ? 'active' : 'inactive'}`,
    });

    req.flash('success', `"${pkg.name}" is now ${updated.isActive ? 'visible to customers' : 'hidden'}.`);
    return res.redirect('/admin/packages');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/packages/:id/delete
// ---------------------------------------------------------------
router.post('/:id/delete', requirePermission('packages'), async (req, res, next) => {
  try {
    const [orders, subs] = await Promise.all([
      prisma.order.count({ where: { packageId: req.params.id } }),
      prisma.subscription.count({ where: { packageId: req.params.id } }),
    ]);

    if (orders > 0 || subs > 0) {
      await prisma.package.update({ where: { id: req.params.id }, data: { isActive: false } });
      await audit.log(req, 'package.deactivated', {
        entityType: 'Package',
        entityId: req.params.id,
        detail: `Deactivated: ${orders} order(s), ${subs} subscription(s)`,
      });
      req.flash('warning', 'This package has orders or subscriptions attached, so it was deactivated instead of deleted.');
      return res.redirect('/admin/packages');
    }

    await prisma.package.delete({ where: { id: req.params.id } });
    await audit.log(req, 'package.deleted', { entityType: 'Package', entityId: req.params.id });

    req.flash('success', 'Package deleted.');
    return res.redirect('/admin/packages');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
