'use strict';

const prisma = require('../config/prisma');
const { applyDiscount, vat: calcVat } = require('../utils/json');

/**
 * Pricing engine.
 *
 * One place that decides what a customer actually owes, so the checkout page,
 * the order record and the generated invoice can never disagree.
 *
 * Order of operations: subtotal -> coupon discount -> VAT on the discounted
 * amount. VAT is charged on the service fee only, matching how service VAT is
 * normally applied in Bangladesh.
 */

async function settings() {
  let row = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });
  if (!row) row = await prisma.siteSetting.create({ data: { id: 'singleton' } });
  return row;
}

/**
 * Validate a coupon code against the current cart.
 * Returns { valid, reason, discount, coupon }.
 */
async function evaluateCoupon(code, subtotal, appliesTo = 'ALL') {
  if (!code) return { valid: false, reason: 'No coupon applied.', discount: 0, coupon: null };

  const coupon = await prisma.coupon.findUnique({ where: { code: String(code).trim().toUpperCase() } });

  if (!coupon) return { valid: false, reason: 'This coupon code does not exist.', discount: 0, coupon: null };
  if (!coupon.isActive) return { valid: false, reason: 'This coupon is no longer active.', discount: 0, coupon };
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    return { valid: false, reason: 'This coupon has expired.', discount: 0, coupon };
  }
  if (coupon.startsAt && coupon.startsAt > new Date()) {
    return { valid: false, reason: 'This coupon is not active yet.', discount: 0, coupon };
  }
  if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
    return { valid: false, reason: 'This coupon has reached its usage limit.', discount: 0, coupon };
  }
  if (coupon.appliesTo !== 'ALL' && coupon.appliesTo !== appliesTo) {
    return { valid: false, reason: `This coupon only applies to ${coupon.appliesTo.toLowerCase()} purchases.`, discount: 0, coupon };
  }
  if (subtotal < coupon.minOrder) {
    return {
      valid: false,
      reason: `Minimum order of ৳${coupon.minOrder.toLocaleString('en-BD')} required for this coupon.`,
      discount: 0,
      coupon,
    };
  }

  const discount = applyDiscount(subtotal, coupon.discountType, coupon.discountValue);
  const label = coupon.discountType === 'PERCENT' ? `${coupon.discountValue}% off` : `৳${coupon.discountValue} off`;
  return { valid: true, reason: `${label} applied.`, discount, coupon };
}

/**
 * Quote a package purchase.
 * mode: 'one_time' uses the build price, 'monthly'/'yearly' use the plan price.
 */
async function quotePackage({ packageId, couponCode, paymentMode = 'one_time' }) {
  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    include: { service: { select: { id: true, title: true, slug: true } } },
  });
  if (!pkg) throw Object.assign(new Error('Package not found.'), { status: 404 });
  if (!pkg.isActive) throw Object.assign(new Error('This package is not currently available.'), { status: 400 });

  const site = await settings();

  let subtotal = Number(pkg.price || 0);
  let recurring = null;

  if (paymentMode === 'monthly') {
    subtotal = Number(pkg.monthlyPrice || 0);
    recurring = { cycle: 'MONTHLY', amount: subtotal, months: 1 };
  } else if (paymentMode === 'yearly') {
    subtotal = Number(pkg.yearlyPrice || 0);
    recurring = { cycle: 'YEARLY', amount: subtotal, months: 12 };
  }

  const setupFee = Number(pkg.setupFee || 0);
  const gross = subtotal + setupFee;

  const coupon = await evaluateCoupon(couponCode, gross, 'PACKAGE');
  const discount = coupon.valid ? coupon.discount : 0;
  const taxable = Math.max(0, gross - discount);
  const tax = calcVat(taxable, site.vatPercent);
  const total = Math.round((taxable + tax) * 100) / 100;

  return {
    package: pkg,
    service: pkg.service,
    paymentMode,
    lineItems: [
      { label: `${pkg.name} — ${paymentMode === 'one_time' ? 'one-time build' : paymentMode}`, amount: subtotal },
      ...(setupFee > 0 ? [{ label: 'Setup fee', amount: setupFee }] : []),
      ...(discount > 0 ? [{ label: `Coupon ${couponCode}`, amount: -discount }] : []),
      ...(tax > 0 ? [{ label: `VAT (${site.vatPercent}%)`, amount: tax }] : []),
    ],
    subtotal: gross,
    discount,
    tax,
    vatPercent: site.vatPercent,
    total,
    coupon: coupon.valid ? coupon.coupon : null,
    couponMessage: coupon.reason,
    recurring,
  };
}

/** Quote a subscription renewal for one period. */
async function quoteRenewal(subscription) {
  const site = await settings();
  const addons = await prisma.subscriptionAddon.findMany({
    where: { subscriptionId: subscription.id, isActive: true },
  });

  const base = Number(subscription.amount || 0);
  const addonTotal = addons.reduce((sum, a) => sum + Number(a.price) * (a.quantity || 1), 0);
  const subtotal = base + addonTotal;

  const discount = applyDiscount(subtotal, 'PERCENT', subscription.discountPercent || 0);
  const taxable = Math.max(0, subtotal - discount);
  const tax = calcVat(taxable, site.vatPercent);

  return {
    lineItems: [
      { label: `${subscription.planName} — ${subscription.billingCycle.toLowerCase()}`, amount: base },
      ...addons.map((a) => ({ label: `${a.name} × ${a.quantity || 1}`, amount: Number(a.price) * (a.quantity || 1) })),
      ...(discount > 0 ? [{ label: `Discount (${subscription.discountPercent}%)`, amount: -discount }] : []),
      ...(tax > 0 ? [{ label: `VAT (${site.vatPercent}%)`, amount: tax }] : []),
    ],
    subtotal,
    discount,
    tax,
    total: Math.round((taxable + tax) * 100) / 100,
  };
}

/** Consultancy / custom-scope quote used by the sales team. */
function quoteCustom({ basePrice, addons = [], discountPercent = 0, vatPercent = 5 }) {
  const addonTotal = addons.reduce((sum, a) => sum + Number(a.price || 0) * Number(a.quantity || 1), 0);
  const subtotal = Number(basePrice || 0) + addonTotal;
  const discount = applyDiscount(subtotal, 'PERCENT', discountPercent);
  const taxable = Math.max(0, subtotal - discount);
  const tax = calcVat(taxable, vatPercent);
  return { subtotal, discount, tax, total: Math.round((taxable + tax) * 100) / 100 };
}

module.exports = { settings, evaluateCoupon, quotePackage, quoteRenewal, quoteCustom };
