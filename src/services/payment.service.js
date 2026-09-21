'use strict';

const prisma = require('../config/prisma');
const ids = require('../utils/ids');
const invoiceService = require('./invoice.service');
const orderService = require('./order.service');
const audit = require('./audit.service');

/**
 * Payment recording and verification.
 *
 * Two entry points:
 *  - submitManual(): customer pastes a wallet TrxID -> row created as PENDING
 *  - verify():       staff confirms it in the admin panel -> SUCCESS, then
 *                    downstream order/invoice/subscription state is updated
 *
 * Nothing is ever auto-marked SUCCESS. A fake "paid" flag would corrupt the
 * revenue reports, which is worse than a manual step.
 */

async function createPayment(input) {
  const {
    userId, invoiceId = null, orderId = null, amount, method = 'MANUAL',
    transactionId = null, senderNumber = null, gatewayPayload = null,
    status = 'PENDING', direction = 'INBOUND', paidAt = null,
  } = input;

  return prisma.payment.create({
    data: {
      reference: ids.paymentReference(),
      userId,
      invoiceId,
      orderId,
      amount: Number(amount),
      method,
      direction,
      status,
      transactionId,
      senderNumber,
      gatewayPayload: gatewayPayload ? JSON.stringify(gatewayPayload) : null,
      paidAt: paidAt ? new Date(paidAt) : null,
    },
  });
}

/** Customer-submitted wallet payment awaiting verification. */
async function submitManual(input) {
  const existing = input.transactionId
    ? await prisma.payment.findFirst({ where: { transactionId: input.transactionId } })
    : null;

  // Re-submitting the same TrxID is usually a double-click, not fraud — but it
  // must not create a second payable row.
  if (existing) {
    throw Object.assign(new Error('This transaction ID has already been submitted.'), { status: 409 });
  }

  const payment = await createPayment({ ...input, status: 'PENDING' });

  // Tell the team a transfer is waiting to be checked. Fire-and-forget: a mail
  // failure must never roll back a payment the customer has already sent.
  // Required lazily to avoid a require cycle (mailer -> prisma -> ... -> here).
  try {
    require('./mailer.service').notify('adminNewPayment', [payment], { kind: 'admin' }).catch(() => {});
  } catch { /* mail is best-effort */ }

  return payment;
}

/**
 * Staff verifies a pending payment.
 * Then: invoice recalculated, order balance updated, subscription period
 * advanced if the invoice belongs to a recurring plan.
 */
async function verify(paymentId, { actorId = null, actor = null } = {}) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: true, order: true },
  });
  if (!payment) throw Object.assign(new Error('Payment not found.'), { status: 404 });
  if (payment.status === 'SUCCESS') return payment;

  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'SUCCESS', verifiedById: actorId, verifiedAt: new Date(), paidAt: payment.paidAt || new Date() },
  });

  if (payment.orderId) {
    await orderService.applyPaymentToOrder(payment.orderId, payment.amount);
  }

  if (payment.invoiceId) {
    const invoice = await invoiceService.recalculate(payment.invoiceId);

    // A fully paid renewal invoice rolls the subscription forward.
    if (invoice && invoice.status === 'PAID' && invoice.subscriptionId) {
      const subscription = await prisma.subscription.findUnique({ where: { id: invoice.subscriptionId } });
      if (subscription && ['ACTIVE', 'PAST_DUE', 'TRIALING'].includes(subscription.status)) {
        const subscriptionService = require('./subscription.service');
        await subscriptionService.advancePeriod(subscription, subscription.currentPeriodEnd);
      }
    }
  }

  if (actor) {
    await audit.log(actor, 'payment.verified', {
      entityType: 'Payment',
      entityId: paymentId,
      detail: `${payment.reference} — BDT ${payment.amount} via ${payment.method}`,
    });
  }

  return updated;
}

async function reject(paymentId, reason) {
  return prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'FAILED', failureReason: reason || 'Rejected by accounts team.' },
  });
}

async function refund(paymentId, reason) {
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'REFUNDED', failureReason: reason || null },
  });

  if (payment.invoiceId) await invoiceService.recalculate(payment.invoiceId);
  if (payment.orderId) {
    const order = await prisma.order.findUnique({ where: { id: payment.orderId } });
    if (order) {
      const refunded = Math.max(0, Number(order.paidAmount) - Number(payment.amount));
      await prisma.order.update({
        where: { id: order.id },
        data: { paidAmount: refunded, paymentStatus: refunded > 0 ? 'PARTIAL' : 'UNPAID' },
      });
    }
  }

  return payment;
}

/** Totals for the admin payments screen. */
async function summary(from = null, to = null) {
  const range = from && to ? { createdAt: { gte: from, lte: to } } : {};

  const [pending, success, refunded, byMethod] = await Promise.all([
    prisma.payment.aggregate({ where: { ...range, status: 'PENDING' }, _sum: { amount: true }, _count: true }),
    prisma.payment.aggregate({ where: { ...range, status: 'SUCCESS' }, _sum: { amount: true }, _count: true }),
    prisma.payment.aggregate({ where: { ...range, status: 'REFUNDED' }, _sum: { amount: true }, _count: true }),
    prisma.payment.groupBy({
      by: ['method'],
      where: { ...range, status: 'SUCCESS' },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  return {
    pendingAmount: pending._sum.amount || 0,
    pendingCount: pending._count || 0,
    receivedAmount: success._sum.amount || 0,
    receivedCount: success._count || 0,
    refundedAmount: refunded._sum.amount || 0,
    refundedCount: refunded._count || 0,
    byMethod: byMethod.map((r) => ({ method: r.method, amount: r._sum.amount || 0, count: r._count })),
  };
}

module.exports = { createPayment, submitManual, verify, reject, refund, summary };
