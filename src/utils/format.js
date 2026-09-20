'use strict';

/** Currency, date and text helpers used by both the API and the EJS views. */

const config = require('../config');

/** Format a number as Bangladeshi Taka with the Bengali-style grouping. */
function bdt(amount, opts = {}) {
  const value = Number(amount || 0);
  const { compact = false, withSymbol = true } = opts;

  let out;
  if (compact && Math.abs(value) >= 100000) {
    out = `${(value / 100000).toFixed(value % 100000 === 0 ? 0 : 2)} লক্ষ`;
  } else if (compact && Math.abs(value) >= 1000) {
    out = `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
  } else {
    out = value.toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return withSymbol ? `৳${out}` : out;
}

/** Plain number with thousand separators. */
function number(value, decimals = 0) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function date(value, style = 'medium') {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const opts =
    style === 'short'
      ? { day: '2-digit', month: 'short', year: 'numeric' }
      : style === 'long'
        ? { day: 'numeric', month: 'long', year: 'numeric' }
        : { day: '2-digit', month: 'short', year: 'numeric' };
  return d.toLocaleDateString('en-GB', opts);
}

function datetime(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${date(d)} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** "3 days ago" / "in 5 days" — used in dashboards. */
function relative(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units = [
    ['year', 31536000000], ['month', 2592000000], ['day', 86400000],
    ['hour', 3600000], ['minute', 60000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms);
      const label = `${n} ${unit}${n > 1 ? 's' : ''}`;
      return diff > 0 ? `in ${label}` : `${label} ago`;
    }
  }
  return 'just now';
}

/** Days remaining until a date (negative = overdue). */
function daysUntil(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function daysBetween(from, to) {
  const a = from instanceof Date ? from : new Date(from);
  const b = to instanceof Date ? to : new Date(to);
  return Math.max(1, Math.ceil((b.getTime() - a.getTime()) / 86400000));
}

/** Add N months to a date, clamping the day to the end of the target month. */
function addMonths(base, months) {
  const d = new Date(base);
  const targetDay = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < targetDay) d.setDate(0);
  return d;
}

function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\u0980-\u09FF\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

/** Percent change between two numbers, guarding divide-by-zero. */
function percentChange(current, previous) {
  const prev = Number(previous || 0);
  const cur = Number(current || 0);
  if (prev === 0) return cur === 0 ? 0 : 100;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function truncate(text, length = 120) {
  const s = String(text || '');
  return s.length <= length ? s : `${s.slice(0, length - 1).trimEnd()}…`;
}

function maskPhone(phone) {
  const s = String(phone || '');
  if (s.length < 6) return s;
  return `${s.slice(0, 4)}****${s.slice(-2)}`;
}

module.exports = {
  bdt, number, date, datetime, relative, daysUntil, daysBetween,
  addMonths, slugify, initials, percentChange, truncate, maskPhone,
  currency: config.appUrl ? 'BDT' : 'BDT',
};
