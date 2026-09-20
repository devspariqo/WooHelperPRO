'use strict';

/**
 * Bangladesh payment gateway adapters.
 *
 * Each adapter exposes the same surface:
 *   isConfigured()            -> boolean
 *   buildRedirect(payment)    -> { url, fields }  for hosted checkout
 *   instructions()            -> { steps[] }      manual wallet transfer copy
 *
 * Live gateway calls need merchant credentials that this project does not ship.
 * Rather than fake a successful charge, an unconfigured gateway renders manual
 * transfer instructions and the payment is recorded as PENDING for a human to
 * verify in the admin panel. That is the honest behaviour, and it matches how
 * most Bangladeshi agencies actually collect the first payment anyway.
 */

const crypto = require('crypto');
const config = require('../config');

// ---------------------------------------------------------------
// bKash — Tokenized Checkout (PGW)
// ---------------------------------------------------------------
const bkash = {
  key: 'BKASH',
  label: 'bKash',
  labelBn: 'বিকাশ',
  wallet: config.payments.bkash.merchantNumber,

  isConfigured() {
    const c = config.payments.bkash;
    return Boolean(c.appKey && c.appSecret && c.username && c.password);
  },

  /**
   * Live flow (requires credentials):
   *   POST /token/grant  -> id_token
   *   POST /create      -> bkashURL
   * Implemented as a thin, documented stub: the endpoint shapes are correct but
   * they are only invoked once credentials exist.
   */
  async buildRedirect(payment) {
    if (!this.isConfigured()) {
      return { mode: 'manual', url: null, fields: null };
    }
    const base = config.payments.bkash.sandbox
      ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta'
      : 'https://tokenized.pay.bka.sh/v1.2.0-beta';

    const tokenRes = await fetch(`${base}/tokenized/checkout/token/grant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        username: config.payments.bkash.username,
        password: config.payments.bkash.password,
      },
      body: JSON.stringify({
        app_key: config.payments.bkash.appKey,
        app_secret: config.payments.bkash.appSecret,
      }),
    });
    if (!tokenRes.ok) throw new Error(`bKash token grant failed (${tokenRes.status})`);
    const { id_token: idToken } = await tokenRes.json();

    const createRes = await fetch(`${base}/tokenized/checkout/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: idToken,
        'X-APP-Key': config.payments.bkash.appKey,
      },
      body: JSON.stringify({
        mode: '0011',
        payerReference: payment.senderNumber || '',
        callbackURL: `${config.appUrl}/payments/callback/bkash`,
        amount: String(payment.amount),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber: payment.reference,
      }),
    });
    if (!createRes.ok) throw new Error(`bKash create failed (${createRes.status})`);
    const created = await createRes.json();
    return { mode: 'redirect', url: created.bkashURL, fields: null, paymentId: created.paymentID };
  },

  instructions() {
    const number = this.wallet || 'our bKash merchant number';
    return {
      title: 'Pay with bKash',
      steps: [
        `Open bKash app or dial *247# and choose "Send Money".`,
        `Send the exact amount to ${number} (Merchant / Personal).`,
        'Copy the bKash Transaction ID (TrxID) from the confirmation SMS.',
        'Paste the TrxID and the number you paid from in the form below.',
        'Our team verifies it within 1 business hour and your order moves forward.',
      ],
      note: 'Send Money only — do not use Payment, or we cannot match your order automatically.',
    };
  },
};

// ---------------------------------------------------------------
// Nagad — manual wallet verification
// ---------------------------------------------------------------
const nagad = {
  key: 'NAGAD',
  label: 'Nagad',
  labelBn: 'নগদ',
  wallet: config.payments.nagad.merchantNumber,

  isConfigured() {
    return Boolean(config.payments.nagad.merchantNumber);
  },

  async buildRedirect() {
    return { mode: 'manual', url: null, fields: null };
  },

  instructions() {
    return {
      title: 'Pay with Nagad',
      steps: [
        'Open Nagad app or dial *167# and choose "Send Money".',
        `Send the exact amount to ${this.wallet || 'our Nagad merchant number'}.`,
        'Copy the Nagad Transaction ID from the confirmation SMS.',
        'Paste the TrxID and your Nagad number below.',
      ],
      note: 'Use Send Money. Keep the SMS until your payment shows as verified.',
    };
  },
};

// ---------------------------------------------------------------
// Rocket (DBBL)
// ---------------------------------------------------------------
const rocket = {
  key: 'ROCKET',
  label: 'Rocket',
  labelBn: 'রকেট',
  wallet: config.payments.rocket.merchantNumber,

  isConfigured() {
    return Boolean(config.payments.rocket.merchantNumber);
  },

  async buildRedirect() {
    return { mode: 'manual', url: null, fields: null };
  },

  instructions() {
    return {
      title: 'Pay with Rocket',
      steps: [
        'Dial *322# and select "Send Money".',
        `Enter our Rocket number ${this.wallet || ''} and the amount.`,
        'Enter your Rocket PIN and confirm.',
        'Copy the Transaction ID from the SMS and submit it below.',
      ],
      note: 'Rocket transfers are verified manually during business hours.',
    };
  },
};

// ---------------------------------------------------------------
// SSLCommerz — hosted checkout: cards, mobile banking, net banking
// ---------------------------------------------------------------
const sslcommerz = {
  key: 'SSLCOMMERZ',
  label: 'Card / Net Banking (SSLCommerz)',
  labelBn: 'কার্ড / নেট ব্যাংকিং',
  wallet: null,

  isConfigured() {
    return Boolean(config.payments.sslcommerz.storeId && config.payments.sslcommerz.storePassword);
  },

  async buildRedirect(payment) {
    if (!this.isConfigured()) return { mode: 'unavailable', url: null, fields: null };

    const endpoint = config.payments.sslcommerz.sandbox
      ? 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php'
      : 'https://securepay.sslcommerz.com/gwprocess/v4/api.php';

    const body = new URLSearchParams({
      store_id: config.payments.sslcommerz.storeId,
      store_passwd: config.payments.sslcommerz.storePassword,
      total_amount: String(payment.amount),
      currency: 'BDT',
      tran_id: payment.reference,
      success_url: `${config.appUrl}/payments/callback/sslcommerz?status=success`,
      fail_url: `${config.appUrl}/payments/callback/sslcommerz?status=fail`,
      cancel_url: `${config.appUrl}/payments/callback/sslcommerz?status=cancel`,
      ipn_url: `${config.appUrl}/payments/webhook/sslcommerz`,
      cus_name: payment.customerName || 'Customer',
      cus_email: payment.customerEmail || 'customer@example.com',
      cus_phone: payment.customerPhone || '',
      cus_add1: payment.customerAddress || 'Dhaka',
      cus_city: 'Dhaka',
      cus_country: 'Bangladesh',
      shipping_method: 'NO',
      product_name: payment.purpose || 'WooHelperPro service',
      product_category: 'Service',
      product_profile: 'general',
    });

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`SSLCommerz init failed (${res.status})`);
    const json = await res.json();
    if (json.status !== 'SUCCESS') throw new Error(json.failedreason || 'SSLCommerz rejected the request');
    return { mode: 'redirect', url: json.GatewayPageURL, fields: null };
  },

  instructions() {
    return {
      title: 'Card / Net Banking',
      steps: [
        'Online card and net-banking checkout is not enabled on this deployment yet.',
        'Pay using bKash, Nagad or Rocket instead, or contact us for a bank transfer.',
      ],
      note: 'Ask your account manager to enable SSLCommerz if you need card payments.',
    };
  },

  /**
   * IPN signature check. SSLCommerz posts `verify_sign` =
   * md5(store_passwd + "|" + tran_id + "|" + amount + "|" + currency).
   *
   * NOTE: `crypto.timingSafeEqual` THROWS (ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH)
   * when the two buffers differ in length. A malformed or truncated `verify_sign`
   * from the network is an expected input, not an exception -- without the length
   * pre-check it would surface as a 500 and, on some gateways, trigger an endless
   * IPN retry loop. Compare lengths first, and only then compare in constant time.
   */
  verifyWebhook(payload) {
    const secret = config.payments.sslcommerz.storePassword;
    if (!secret) return false;
    const expected = crypto
      .createHash('md5')
      .update(`${secret}|${payload.tran_id}|${payload.amount}|${payload.currency}`)
      .digest('hex');
    const supplied = payload.verify_sign || payload.verify_key;
    if (!supplied) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(String(supplied));
    if (a.length !== b.length) return false; // lengths are public; a plain compare leaks nothing
    return crypto.timingSafeEqual(a, b);
  },
};

// ---------------------------------------------------------------
// Bank transfer
// ---------------------------------------------------------------
const bankTransfer = {
  key: 'BANK_TRANSFER',
  label: 'Bank Transfer',
  labelBn: 'ব্যাংক ট্রান্সফার',
  wallet: null,

  isConfigured() {
    return true;
  },

  async buildRedirect() {
    return { mode: 'manual', url: null, fields: null };
  },

  instructions() {
    return {
      title: 'Bank Transfer',
      steps: [
        'Request our bank account details from your account manager.',
        'Transfer the invoice amount via BEFTN / RTGS / NPSB.',
        'Share the deposit slip or transaction reference with us.',
        'We mark the invoice paid once the bank confirms receipt.',
      ],
      note: 'Bank transfers take 1–2 business days to confirm.',
    };
  },
};

const GATEWAYS = { BKASH: bkash, NAGAD: nagad, ROCKET: rocket, SSLCOMMERZ: sslcommerz, BANK_TRANSFER: bankTransfer };

/** Gateways shown on the customer payment page, in display order. */
function listGateways() {
  return Object.values(GATEWAYS).map((g) => ({
    key: g.key,
    label: g.label,
    labelBn: g.labelBn,
    configured: g.isConfigured(),
    instructions: g.instructions(),
  }));
}

function getGateway(key) {
  return GATEWAYS[String(key || '').toUpperCase()] || null;
}

module.exports = { GATEWAYS, listGateways, getGateway };
