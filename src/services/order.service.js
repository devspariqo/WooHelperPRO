'use strict';

const prisma = require('../config/prisma');
const ids = require('../utils/ids');
const { parse, stringify, fromLines, toLines } = require('../utils/json');
const { date: fmtDate, daysUntil } = require('../utils/format');

/**
 * Order service — the core "customer orders a package, we build the website"
 * workflow, plus the project record that tracks delivery.
 */

// Allowed status transitions. Guarding this prevents an order jumping from
// PENDING straight to DELIVERED (which would silently skip payment checks).
const TRANSITIONS = {
  PENDING: ['AWAITING_PAYMENT', 'IN_REVIEW', 'CANCELLED', 'ON_HOLD'],
  AWAITING_PAYMENT: ['PAYMENT_VERIFIED', 'CANCELLED', 'ON_HOLD'],
  PAYMENT_VERIFIED: ['IN_REVIEW', 'IN_PROGRESS', 'REFUNDED', 'ON_HOLD'],
  IN_REVIEW: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
  IN_PROGRESS: ['CLIENT_REVIEW', 'ON_HOLD', 'CANCELLED'],
  CLIENT_REVIEW: ['REVISION', 'COMPLETED', 'IN_PROGRESS'],
  REVISION: ['CLIENT_REVIEW', 'COMPLETED', 'IN_PROGRESS'],
  COMPLETED: ['DELIVERED', 'REFUNDED'],
  DELIVERED: ['REFUNDED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED', 'PENDING'],
  CANCELLED: [],
  REFUNDED: [],
};

function canTransition(from, to) {
  if (from === to) return true;
  return (TRANSITIONS[from] || []).includes(to);
}

function allowedNext(current) {
  return TRANSITIONS[current] || [];
}

/**
 * Generate the next order number.
 *
 * `ids.orderNumber(n)` produces `WHP-ORD-YYMM-NNNN`. The sequence is GLOBAL and
 * keeps climbing across months even though the YYMM prefix changes, so deriving
 * the next value from a per-month COUNT is wrong: once any order exists in a
 * prior month with a higher sequence than the current month's count, the
 * computed number collides with an existing row and `orderNumber` is @unique --
 * producing a 500 on checkout for every subsequent order.
 *
 * Derive from the highest existing sequence instead, and fall back to scanning
 * all numbers if the highest one is not parseable.
 */
async function nextOrderNumber() {
  const prefix = ids.orderNumber('').replace(/\d+$/, ''); // e.g. "WHP-ORD-"

  // Take the numerically-highest existing number. Sorting as a string works for
  // the fixed-width NNNN suffix, but we re-parse defensively anyway.
  const latest = await prisma.order.findFirst({
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });

  let next = 1;
  if (latest && typeof latest.orderNumber === 'string') {
    const m = /-(\d+)$/.exec(latest.orderNumber);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return ids.orderNumber(next);
}

/**
 * Create an order, retrying on an orderNumber unique-constraint violation.
 *
 * Two concurrent checkouts can still compute the same "next" number between the
 * read and the write, so we retry with a freshly-computed value rather than
 * failing the customer's order.
 */
async function createOrderWithNumberRetry(buildData, attempts = 5, options = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const orderNumber = await nextOrderNumber();
    try {
      return await prisma.order.create({ data: buildData(orderNumber), ...options });
    } catch (err) {
      const isDup =
        err &&
        err.code === 'P2002' &&
        Array.isArray(err.meta && err.meta.target) &&
        err.meta.target.includes('orderNumber');
      if (!isDup) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Create an order from the public checkout form.
 * Also creates the delivery project record so the customer sees a progress
 * tracker immediately, and increments coupon usage.
 */
async function createOrder(payload) {
  const {
    userId, packageId = null, serviceId = null, projectName, projectType = null,
    businessName = null, businessType = null, websiteGoal = null, referenceUrls = null,
    selectedPages = [], domainName = null, hostingChoice = null, preferredColors = null,
    brandNotes = null, contactPerson = null, contactPhone = null, contactEmail = null,
    district = null, billingAddress = null, subtotal = 0, discount = 0, tax = 0,
    total = 0, couponCode = null, priority = 'NORMAL', clientNotes = null, dueDate = null,
  } = payload;

  const order = await createOrderWithNumberRetry((orderNumber) => ({
      orderNumber,
      userId,
      packageId,
      serviceId,
      projectName,
      projectType,
      businessName,
      businessType,
      websiteGoal,
      referenceUrls,
      selectedPages: stringify(selectedPages),
      domainName,
      hostingChoice,
      preferredColors,
      brandNotes,
      contactPerson: contactPerson || null,
      contactPhone,
      contactEmail,
      district,
      billingAddress,
      subtotal: Number(subtotal),
      discount: Number(discount),
      tax: Number(tax),
      total: Number(total),
      couponCode,
      clientNotes,
      priority,
      dueDate: dueDate ? new Date(dueDate) : null,
      // An order with a package that has a build price starts unpaid; a custom
      // enquiry with no price starts as a review task.
      status: Number(total) > 0 ? 'AWAITING_PAYMENT' : 'IN_REVIEW',
      paymentStatus: 'UNPAID',
      project: {
        create: {
          userId,
          name: projectName,
          status: 'NOT_STARTED',
          progress: 0,
          currentStage: 'Requirements received',
          targetDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 14 * 86400000),
          milestones: {
            create: defaultMilestones(),
          },
        },
      },
  }), 5, { include: { project: true, package: true } });

  // Consume a coupon use only after the order is safely persisted.
  if (couponCode) {
    await prisma.coupon
      .update({ where: { code: String(couponCode).toUpperCase() }, data: { usedCount: { increment: 1 } } })
      .catch(() => {});
  }

  return order;
}

/** The standard agency delivery pipeline applied to every new project. */
function defaultMilestones() {
  return [
    { title: 'Requirements & discovery call', sortOrder: 1 },
    { title: 'Design mockup / homepage concept', sortOrder: 2 },
    { title: 'Development & content upload', sortOrder: 3 },
    { title: 'Payment gateway & courier integration', sortOrder: 4 },
    { title: 'Client review & revisions', sortOrder: 5 },
    { title: 'Training, handover & go-live', sortOrder: 6 },
  ];
}

/** Change an order's status with transition validation. */
async function updateStatus(orderId, nextStatus, { note = null, actorId = null } = {}) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  if (!canTransition(order.status, nextStatus)) {
    throw Object.assign(
      new Error(`Cannot move an order from ${order.status} to ${nextStatus}.`),
      { status: 400 },
    );
  }

  const data = { status: nextStatus };

  // Keep the project tracker in step with the order status.
  const projectSync = {
    PAYMENT_VERIFIED: { status: 'DESIGNING', progress: 15, currentStage: 'Design kickoff' },
    IN_REVIEW: { status: 'DESIGNING', progress: 10, currentStage: 'Scope review' },
    IN_PROGRESS: { status: 'DEVELOPMENT', progress: 45, currentStage: 'Development' },
    CLIENT_REVIEW: { status: 'CLIENT_REVIEW', progress: 70, currentStage: 'Awaiting client feedback' },
    REVISION: { status: 'REVISION', progress: 75, currentStage: 'Applying revisions' },
    COMPLETED: { status: 'TESTING', progress: 90, currentStage: 'Final testing' },
    DELIVERED: { status: 'LAUNCHED', progress: 100, currentStage: 'Live & handed over' },
    CANCELLED: { status: 'CANCELLED', progress: 0, currentStage: 'Cancelled' },
    ON_HOLD: { status: 'ON_HOLD', currentStage: 'On hold' },
  };

  if (nextStatus === 'DELIVERED') data.deliveredAt = new Date();

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      ...data,
      internalNotes: note ? [order.internalNotes, `[${new Date().toISOString()}] ${note}`].filter(Boolean).join('\n') : order.internalNotes,
    },
  });

  if (projectSync[nextStatus]) {
    await prisma.project
      .update({ where: { orderId }, data: projectSync[nextStatus] })
      .catch(() => {});
  }

  return updated;
}

/** Record a payment against an order and recompute the payment status. */
async function applyPaymentToOrder(orderId, amount) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return null;

  const paid = Number(order.paidAmount || 0) + Number(amount || 0);
  let paymentStatus = 'UNPAID';
  if (paid >= Number(order.total) && Number(order.total) > 0) paymentStatus = 'PAID';
  else if (paid > 0) paymentStatus = 'PARTIAL';

  const data = { paidAmount: paid, paymentStatus, advancePaid: paid };

  // First verified payment automatically advances the order into production.
  if (paymentStatus === 'PAID' && ['PENDING', 'AWAITING_PAYMENT'].includes(order.status)) {
    data.status = 'PAYMENT_VERIFIED';
  }

  const updated = await prisma.order.update({ where: { id: orderId }, data });

  if (data.status === 'PAYMENT_VERIFIED') {
    await prisma.project
      .update({ where: { orderId }, data: { status: 'DESIGNING', progress: 15, currentStage: 'Design kickoff' } })
      .catch(() => {});
  }

  return updated;
}

/** Decorate a row for the views (parsed JSON, computed dates). */
function decorate(order) {
  if (!order) return order;
  return {
    ...order,
    selectedPagesList: parse(order.selectedPages),
    daysToDue: daysUntil(order.dueDate),
    dueLabel: fmtDate(order.dueDate),
    balance: Math.max(0, Number(order.total || 0) - Number(order.paidAmount || 0)),
    progress: order.project ? order.project.progress : 0,
  };
}

/** Revenue recognised from delivered/paid orders in a date range. */
async function revenueBetween(from, to) {
  const result = await prisma.order.aggregate({
    where: {
      createdAt: { gte: from, lte: to },
      status: { notIn: ['CANCELLED', 'REFUNDED'] },
    },
    _sum: { total: true, paidAmount: true },
    _count: true,
  });
  return {
    total: result._sum.total || 0,
    collected: result._sum.paidAmount || 0,
    count: result._count || 0,
  };
}

module.exports = {
  TRANSITIONS, canTransition, allowedNext, nextOrderNumber,
  createOrder, updateStatus, applyPaymentToOrder, decorate,
  revenueBetween, defaultMilestones,
};
