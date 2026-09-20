'use strict';

const express = require('express');

const prisma = require('../config/prisma');
const paymentService = require('../services/payment.service');
const paymentGateway = require('../services/paymentGateway.service');
const audit = require('../services/audit.service');

const router = express.Router();

// ---------------------------------------------------------------
// GET /payments/callback/sslcommerz — browser return from the hosted checkout
// ---------------------------------------------------------------
router.get('/callback/sslcommerz', async (req, res, next) => {
  try {
    const { status, tran_id: reference } = req.query;

    const payment = reference
      ? await prisma.payment.findFirst({ where: { reference: String(reference) } })
      : null;

    if (!payment) {
      req.flash('error', 'We could not match that payment to an invoice. Please contact support.');
      return res.redirect('/account/invoices');
    }

    // Return path is not proof of payment — the IPN webhook validates it.
    // Until the IPN arrives the payment stays PENDING for the accounts team.
    req.flash(
      status === 'success' ? 'success' : 'error',
      status === 'success'
        ? 'Payment received. We are confirming it with the bank and will update your invoice shortly.'
        : 'The payment was not completed. You can try again from the invoice page.',
    );

    return res.redirect(payment.invoiceId ? `/account/invoices/${payment.invoiceId}` : '/account/payments');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /payments/webhook/sslcommerz — IPN (server to server)
// ---------------------------------------------------------------
router.post('/webhook/sslcommerz', async (req, res, next) => {
  try {
    const payload = req.body || {};

    if (!paymentGateway.GATEWAYS.SSLCOMMERZ.verifyWebhook(payload)) {
      console.warn('[sslcommerz] IPN rejected: signature mismatch');
      return res.status(400).send('Invalid signature');
    }

    const payment = await prisma.payment.findFirst({ where: { reference: String(payload.tran_id) } });
    if (!payment) {
      console.warn(`[sslcommerz] IPN for unknown reference ${payload.tran_id}`);
      return res.status(404).send('Unknown transaction');
    }

    if (String(payload.status).toUpperCase() === 'VALID' || String(payload.status).toUpperCase() === 'VALIDATED') {
      await paymentService.verify(payment.id, { actorId: null });
      await prisma.payment.update({
        where: { id: payment.id },
        data: { gatewayPayload: JSON.stringify(payload), transactionId: payload.bank_tran_id || payment.transactionId },
      });
      console.log(`[sslcommerz] payment verified via IPN: ${payment.reference}`);
    } else {
      await paymentService.reject(payment.id, `Gateway reported status ${payload.status}`);
    }

    // SSLCommerz expects a 200 with this body to stop retrying.
    return res.status(200).send('IPN received');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /payments/webhook/bkash — bKash callback / IPN
// ---------------------------------------------------------------
router.post('/webhook/bkash', async (req, res, next) => {
  try {
    const payload = req.body || {};
    const reference = payload.merchantInvoiceNumber || payload.paymentID;

    const payment = reference
      ? await prisma.payment.findFirst({ where: { reference: String(reference) } })
      : null;

    if (!payment) {
      console.warn(`[bkash] webhook for unknown reference ${reference}`);
      return res.status(404).json({ ok: false, error: 'Unknown transaction' });
    }

    // bKash requires the Execute API call to be treated as authoritative, not
    // the callback body. Without credentials configured we record the payload
    // and leave verification to the accounts team.
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        gatewayPayload: JSON.stringify(payload),
        transactionId: payload.trxID || payment.transactionId,
      },
    });

    await audit.log(req, 'payment.bkash_webhook', {
      entityType: 'Payment',
      entityId: payment.id,
      detail: `${payment.reference} — status ${payload.transactionStatus || 'unknown'}`,
    });

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
