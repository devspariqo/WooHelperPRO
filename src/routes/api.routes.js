'use strict';

const express = require('express');

const prisma = require('../config/prisma');
const pricing = require('../services/pricing.service');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------
// GET /api/services — public service catalogue (used by the order form)
// ---------------------------------------------------------------
router.get('/services', async (req, res, next) => {
  try {
    const services = await prisma.service.findMany({
      where: { status: 'ACTIVE' },
      include: { category: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ ok: true, count: services.length, data: services });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/packages — public package catalogue
// ---------------------------------------------------------------
router.get('/packages', async (req, res, next) => {
  try {
    const packages = await prisma.package.findMany({
      where: { isActive: true },
      include: { service: { select: { title: true, slug: true } } },
      orderBy: [{ isPopular: 'desc' }, { price: 'asc' }],
    });

    res.json({
      ok: true,
      count: packages.length,
      data: packages.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        tier: p.tier,
        price: p.price,
        monthlyPrice: p.monthlyPrice,
        yearlyPrice: p.yearlyPrice,
        setupFee: p.setupFee,
        deliveryDays: p.deliveryDays,
        pagesIncluded: p.pagesIncluded,
        revisions: p.revisions,
        supportMonths: p.supportMonths,
        isPopular: p.isPopular,
        service: p.service ? p.service.title : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/quote — price a package selection (used by the checkout UI)
// ---------------------------------------------------------------
router.post('/quote', async (req, res, next) => {
  try {
    const { packageId, couponCode, paymentMode } = req.body || {};
    if (!packageId) return res.status(400).json({ ok: false, error: 'packageId is required' });

    const quote = await pricing.quotePackage({
      packageId: String(packageId),
      couponCode: couponCode ? String(couponCode) : null,
      paymentMode: ['one_time', 'monthly', 'yearly'].includes(paymentMode) ? paymentMode : 'one_time',
    });

    return res.json({
      ok: true,
      data: {
        subtotal: quote.subtotal,
        discount: quote.discount,
        tax: quote.tax,
        total: quote.total,
        vatPercent: quote.vatPercent,
        lineItems: quote.lineItems,
        couponApplied: Boolean(quote.coupon),
        couponMessage: quote.couponMessage,
        recurring: quote.recurring,
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/coupons/validate — validate a coupon without ordering
// ---------------------------------------------------------------
router.post('/coupons/validate', async (req, res, next) => {
  try {
    const { code, amount = 0, appliesTo = 'PACKAGE' } = req.body || {};
    if (!code) return res.status(400).json({ ok: false, valid: false, error: 'Coupon code is required' });

    const result = await pricing.evaluateCoupon(String(code), Number(amount), String(appliesTo));
    return res.json({
      ok: true,
      valid: result.valid,
      discount: result.discount,
      message: result.reason,
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/me — the signed-in principal, for client-side rendering
// ---------------------------------------------------------------
router.get('/me', requireAuth, (req, res) => {
  res.json({
    ok: true,
    data: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      district: req.user.district,
    },
  });
});

module.exports = router;
