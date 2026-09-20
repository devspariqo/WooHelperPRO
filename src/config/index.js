'use strict';

require('dotenv').config();

const path = require('path');

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

// Refuse to boot in production with the placeholder secret — a hardcoded
// fallback secret in a public repo is a real vulnerability, not a style nit.
if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('change-me') || process.env.SESSION_SECRET.includes('dev-only'))) {
  console.error('\n[FATAL] SESSION_SECRET is missing or still set to a development placeholder.');
  console.error('        Set a long random value in .env before running in production.\n');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..', '..');

module.exports = {
  env,
  isProd,
  rootDir,
  port: num(process.env.PORT, 3000),
  appUrl: process.env.APP_URL || `http://localhost:${num(process.env.PORT, 3000)}`,
  appName: process.env.APP_NAME || 'WooHelperPro',

  session: {
    secret: process.env.SESSION_SECRET || 'insecure-development-secret',
    name: 'whp.sid',
    maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
  },

  upload: {
    dir: process.env.UPLOAD_DIR || 'public/uploads',
    maxBytes: num(process.env.MAX_UPLOAD_MB, 5) * 1024 * 1024,
  },

  // Bangladesh payment rails. Empty credentials => the gateway renders as
  // "not configured" and the checkout falls back to manual wallet transfer.
  payments: {
    bkash: {
      merchantNumber: process.env.BKASH_MERCHANT_NUMBER || '',
      appKey: process.env.BKASH_APP_KEY || '',
      appSecret: process.env.BKASH_APP_SECRET || '',
      username: process.env.BKASH_USERNAME || '',
      password: process.env.BKASH_PASSWORD || '',
      sandbox: bool(process.env.BKASH_SANDBOX, true),
    },
    nagad: {
      merchantNumber: process.env.NAGAD_MERCHANT_NUMBER || '',
    },
    rocket: {
      merchantNumber: process.env.ROCKET_MERCHANT_NUMBER || '',
    },
    sslcommerz: {
      storeId: process.env.SSLCOMMERZ_STORE_ID || '',
      storePassword: process.env.SSLCOMMERZ_STORE_PASSWORD || '',
      sandbox: bool(process.env.SSLCOMMERZ_SANDBOX, true),
    },
  },

  couriers: {
    pathao: { clientId: process.env.PATHAO_CLIENT_ID || '', clientSecret: process.env.PATHAO_CLIENT_SECRET || '' },
    steadfast: { apiKey: process.env.STEADFAST_API_KEY || '', secretKey: process.env.STEADFAST_SECRET_KEY || '' },
  },

  mail: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || 'WooHelperPro <no-reply@woohelperpro.com>',
  },
};
