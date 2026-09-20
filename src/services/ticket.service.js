'use strict';

const prisma = require('../config/prisma');
const ids = require('../utils/ids');

/**
 * Support tickets.
 *
 * `ticketNumber` is @unique. An earlier implementation used
 * `ids.ticketNumber(Date.now() % 10000)`, which repeats every ~10 seconds -- so
 * any two tickets raised in the same window collided and the insert was
 * silently swallowed by a `.catch(() => {})` at the call site. Derive from the
 * highest existing number instead.
 */

async function nextTicketNumber() {
  const latest = await prisma.ticket.findFirst({
    orderBy: { ticketNumber: 'desc' },
    select: { ticketNumber: true },
  });
  return ids.ticketNumber(ids.nextSequenceFrom(latest && latest.ticketNumber));
}

/**
 * Create a ticket with a collision-safe number.
 * Retries if a concurrent insert claims the same number in between.
 */
async function createTicket(input, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const ticketNumber = await nextTicketNumber();
    try {
      return await prisma.ticket.create({ data: { ...input, ticketNumber } });
    } catch (err) {
      const isDup =
        err && err.code === 'P2002' &&
        Array.isArray(err.meta && err.meta.target) &&
        err.meta.target.includes('ticketNumber');
      if (!isDup) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

module.exports = { nextTicketNumber, createTicket };
