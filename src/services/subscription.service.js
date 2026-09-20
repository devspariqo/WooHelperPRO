'use strict';

const prisma = require('../config/prisma');
const ids = require('../utils/ids');
const { parse, stringify } = require('../utils/json');
const { addMonths, daysUntil, date: fmtDate } = require('../utils/format');

/**
 * Subscription lifecycle: create, renew, pause, resume, cancel, and the daily
 * sweep that flips expired plans to PAST_DUE / EXPIRED and raises renewal
 * invoices.
 */

const CYCLE_MONTHS = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };

function monthsFor(cycle) {
  return CYCLE_MONTHS[cycle] || 1;
}

/**
 * Next subscription number.
 *
 * The NNNN suffix is a global counter that keeps climbing across months, so it
 * must come from the highest existing number, not a per-month row count -- a
 * count collides with any older month that holds a higher sequence, and
 * `subscriptionNumber` is @unique.
 */
async function nextSubscriptionNumber() {
  const latest = await prisma.subscription.findFirst({
    orderBy: { subscriptionNumber: 'desc' },
    select: { subscriptionNumber: true },
  });
  return ids.subscriptionNumber(ids.nextSequenceFrom(latest && latest.subscriptionNumber));
}

/**
 * Create a subscription for a customer.
 * A subscription without a billing cycle of ONE_TIME is by definition recurring.
 * Retries on a subscriptionNumber collision from a concurrent write.
 */
async function createSubscription(input) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await createSubscriptionOnce(input);
    } catch (err) {
      const isDup =
        err && err.code === 'P2002' &&
        Array.isArray(err.meta && err.meta.target) &&
        err.meta.target.includes('subscriptionNumber');
      if (!isDup) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

async function createSubscriptionOnce(input) {
  const {
    userId, packageId = null, planName, billingCycle = 'MONTHLY',
    amount = 0, setupFee = 0, discountPercent = 0, notes = null,
    trialDays = 0, startsAt = new Date(),
  } = input;

  const periodStart = new Date(startsAt);
  const periodEnd = addMonths(periodStart, monthsFor(billingCycle));

  const subscription = await prisma.subscription.create({
    data: {
      subscriptionNumber: await nextSubscriptionNumber(),
      userId,
      packageId,
      planName,
      billingCycle,
      amount: Number(amount),
      setupFee: Number(setupFee),
      discountPercent: Number(discountPercent),
      notes,
      status: trialDays > 0 ? 'TRIALING' : 'ACTIVE',
      startsAt: periodStart,
      trialEndsAt: trialDays > 0 ? new Date(periodStart.getTime() + trialDays * 86400000) : null,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      nextInvoiceAt: periodEnd,
      autoRenew: true,
    },
  });

  return subscription;
}

/** Extend a subscription by one billing period and roll the invoice date forward. */
async function advancePeriod(subscription, from = null) {
  const base = from || subscription.currentPeriodEnd || new Date();
  const next = addMonths(base, monthsFor(subscription.billingCycle));
  return prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      currentPeriodStart: base,
      currentPeriodEnd: next,
      nextInvoiceAt: next,
      status: 'ACTIVE',
    },
  });
}

async function pause(id, reason) {
  return prisma.subscription.update({
    where: { id },
    data: { status: 'PAUSED', notes: reason ? `Paused: ${reason}` : undefined },
  });
}

async function resume(id) {
  return prisma.subscription.update({ where: { id }, data: { status: 'ACTIVE' } });
}

async function cancel(id, reason) {
  return prisma.subscription.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelReason: reason || null,
      autoRenew: false,
    },
  });
}

/** Flip auto-renew and return the updated row. */
async function setAutoRenew(id, value) {
  return prisma.subscription.update({ where: { id }, data: { autoRenew: Boolean(value) } });
}

/**
 * Daily maintenance sweep.
 * - ACTIVE but past currentPeriodEnd + grace -> PAST_DUE
 * - PAST_DUE beyond 2x grace -> EXPIRED
 * - TRIALING past trialEndsAt -> ACTIVE (billing starts now)
 *
 * Returns a summary so the admin dashboard can report what changed.
 */
async function runBillingSweep({ dryRun = false } = {}) {
  const now = new Date();
  const summary = { markedPastDue: [], activatedFromTrial: [], markedExpired: [], errors: [] };

  const subscriptions = await prisma.subscription.findMany({
    where: { status: { in: ['ACTIVE', 'PAST_DUE', 'TRIALING'] } },
  });

  for (const sub of subscriptions) {
    try {
      if (sub.status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt <= now) {
        if (!dryRun) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: {
              status: 'ACTIVE',
              currentPeriodStart: sub.trialEndsAt,
              currentPeriodEnd: addMonths(sub.trialEndsAt, monthsFor(sub.billingCycle)),
              nextInvoiceAt: addMonths(sub.trialEndsAt, monthsFor(sub.billingCycle)),
            },
          });
        }
        summary.activatedFromTrial.push(sub.subscriptionNumber);
        continue;
      }

      const graceMs = (sub.gracePeriodDays || 7) * 86400000;
      const overdueBy = now.getTime() - sub.currentPeriodEnd.getTime();

      if (sub.status === 'ACTIVE' && overdueBy > graceMs) {
        if (!dryRun) {
          await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } });
        }
        summary.markedPastDue.push(sub.subscriptionNumber);
      } else if (sub.status === 'PAST_DUE' && overdueBy > graceMs * 2) {
        if (!dryRun) {
          await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'EXPIRED' } });
        }
        summary.markedExpired.push(sub.subscriptionNumber);
      }
    } catch (err) {
      summary.errors.push({ id: sub.id, error: err.message });
    }
  }

  return summary;
}

/** Subscriptions renewing within N days — drives the admin "renewals due" widget. */
async function renewalsDue(days = 14) {
  const until = new Date(Date.now() + days * 86400000);
  return prisma.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'PAST_DUE'] },
      currentPeriodEnd: { lte: until },
    },
    include: { user: { select: { id: true, name: true, email: true, phone: true } }, package: true },
    orderBy: { currentPeriodEnd: 'asc' },
  });
}

/** Normalise a subscription row for display. */
function decorate(sub) {
  if (!sub) return sub;
  return {
    ...sub,
    monthsPerCycle: monthsFor(sub.billingCycle),
    daysRemaining: daysUntil(sub.currentPeriodEnd),
    periodEndLabel: fmtDate(sub.currentPeriodEnd),
    isRecurring: sub.billingCycle !== 'ONE_TIME',
  };
}

module.exports = {
  monthsFor, createSubscription, advancePeriod, pause, resume, cancel,
  setAutoRenew, runBillingSweep, renewalsDue, decorate, nextSubscriptionNumber,
};
