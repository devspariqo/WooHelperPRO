'use strict';

const crypto = require('crypto');

/**
 * Human-readable document numbers.
 * Format: PREFIX-KIND-YYMM-NNNN  e.g. WHP-ORD-2609-0042
 *
 * IMPORTANT -- how the sequence works:
 * The NNNN suffix is a single GLOBAL counter per document kind. It keeps
 * climbing across months; only the YYMM part changes. It is therefore WRONG to
 * derive the next value from a per-month row COUNT: as soon as any older month
 * holds a higher sequence than the current month's count, the computed number
 * collides with an existing row. Every one of these columns is @unique, so the
 * collision surfaces as a 500 on the customer's checkout.
 *
 * Always derive the next value from the highest existing number -- see
 * `nextSequenceFrom()` and the per-service `nextXNumber()` helpers, which read
 * the max before generating.
 */

const PREFIX = 'WHP';

function monthKey(date = new Date()) {
  const y = String(date.getFullYear()).slice(2);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

function pad(n, width = 4) {
  return String(n).padStart(width, '0');
}

function build(kind, sequence) {
  return `${PREFIX}-${kind}-${monthKey()}-${pad(sequence)}`;
}

/** Short random token used when we just need collision-resistant uniqueness. */
function token(length = 8) {
  return crypto.randomBytes(16).toString('hex').slice(0, length).toUpperCase();
}

function orderNumber(seq) { return build('ORD', seq); }
function invoiceNumber(seq) { return build('INV', seq); }
function subscriptionNumber(seq) { return build('SUB', seq); }
function ticketNumber(seq) { return build('TCK', seq); }
function paymentReference() { return `WHP-PAY-${Date.now().toString(36).toUpperCase()}-${token(4)}`; }

/**
 * Extract the numeric sequence from an existing document number.
 * Returns 0 for anything unparseable so callers can safely treat it as "none".
 */
function sequenceOf(number) {
  if (typeof number !== 'string') return 0;
  const m = /-(\d+)\s*$/.exec(number);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Given the highest existing number for a kind, return the next one.
 * This is the correct replacement for counting rows.
 */
function nextSequenceFrom(highestExisting) {
  return sequenceOf(highestExisting) + 1;
}

/**
 * @deprecated Counting rows per month produces collisions once the counter has
 * crossed a month boundary. Kept only so older call sites fail loudly in review;
 * new code must use `nextSequenceFrom`.
 */
function nextSequence(existingCount) {
  return Number(existingCount || 0) + 1;
}

module.exports = {
  monthKey, orderNumber, invoiceNumber, subscriptionNumber,
  ticketNumber, paymentReference, nextSequence, nextSequenceFrom, sequenceOf,
  token, build,
};
