'use strict';

const config = require('../config');

/**
 * Tiny JSON-array helper. Several Prisma fields store arrays as JSON strings
 * because SQLite has no array type. Every read/write goes through here so a
 * malformed value degrades to [] instead of throwing mid-render.
 */
function parse(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    // Tolerate newline/comma separated plain text typed by an admin.
    return String(value)
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

function stringify(value) {
  if (value === null || value === undefined) return '[]';
  if (Array.isArray(value)) return JSON.stringify(value.filter((v) => String(v).trim() !== ''));
  return JSON.stringify(parse(value));
}

/** Turn a textarea (one item per line) into a JSON array string. */
function fromLines(text) {
  return JSON.stringify(
    String(text || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Format a JSON array back into a textarea value. */
function toLines(value) {
  return parse(value).join('\n');
}

/** Discount helper shared by coupons, packages and subscription renewal. */
function applyDiscount(amount, discountType, discountValue) {
  const base = Number(amount || 0);
  const value = Number(discountValue || 0);
  if (base <= 0 || value <= 0) return 0;
  const raw = discountType === 'FIXED' ? value : (base * value) / 100;
  // Never discount more than the order value.
  return Math.min(Math.round(raw * 100) / 100, base);
}

/** VAT is only applied to taxable service fees in Bangladesh (15% standard, 5% commonly used for services). */
function vat(amount, percent) {
  const base = Number(amount || 0);
  const pct = Number(percent ?? 0);
  if (base <= 0 || pct <= 0) return 0;
  return Math.round(((base * pct) / 100) * 100) / 100;
}

module.exports = { parse, stringify, fromLines, toLines, applyDiscount, vat };
