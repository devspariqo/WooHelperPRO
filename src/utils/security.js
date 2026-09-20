'use strict';

const bcrypt = require('bcryptjs');

const ROUNDS = 12;

function hash(password) {
  return bcrypt.hash(password, ROUNDS);
}

function compare(password, hashValue) {
  if (!hashValue) return Promise.resolve(false);
  return bcrypt.compare(password, hashValue);
}

/**
 * Password strength rules. Bangladesh market reality: people sign up from a
 * phone at a desk. We require 8+ chars with a letter and a number — strong
 * enough, not so strict that checkout abandonment spikes.
 */
function validatePassword(password) {
  const errors = [];
  const value = String(password || '');
  if (value.length < 8) errors.push('Password must be at least 8 characters.');
  if (!/[A-Za-z]/.test(value)) errors.push('Password must contain at least one letter.');
  if (!/\d/.test(value)) errors.push('Password must contain at least one number.');
  if (value.length > 128) errors.push('Password is too long (max 128 characters).');
  return { valid: errors.length === 0, errors };
}

/** Bengali mobile numbers: 11 digits starting 013–019, local or +880 form. */
function normalizeBdPhone(input) {
  const digits = String(input || '').replace(/[^\d]/g, '');
  if (digits.startsWith('880') && digits.length === 13) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+880${digits.slice(1)}`;
  if (digits.length === 10 && /^1[3-9]/.test(digits)) return `+880${digits}`;
  return null;
}

function isValidBdPhone(input) {
  return normalizeBdPhone(input) !== null;
}

function isValidEmail(input) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(input || '').trim());
}

/** Escape user content before injecting into any raw HTML context. */
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  hash, compare, validatePassword,
  normalizeBdPhone, isValidBdPhone, isValidEmail, escapeHtml,
};
