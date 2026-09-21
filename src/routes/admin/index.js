'use strict';

const express = require('express');

const dashboardRoutes = require('./dashboard.routes');
const usersRoutes = require('./users.routes');
const servicesRoutes = require('./services.routes');
const packagesRoutes = require('./packages.routes');
const ordersRoutes = require('./orders.routes');
const subscriptionsRoutes = require('./subscriptions.routes');
const billingRoutes = require('./billing.routes');
const crmRoutes = require('./crm.routes');
const contentRoutes = require('./content.routes');
const mediaRoutes = require('./media.routes');

const router = express.Router();

// Mount order is deliberate: the most specific path prefixes are registered
// before the catch-all `/:id` routes inside each sub-router.
router.use('/', dashboardRoutes);
router.use('/users', usersRoutes);
router.use('/services', servicesRoutes);
router.use('/packages', packagesRoutes);
router.use('/orders', ordersRoutes);
router.use('/subscriptions', subscriptionsRoutes);
router.use('/', billingRoutes);   // /invoices, /payments
router.use('/', crmRoutes);       // /tickets, /leads, /coupons, /projects
router.use('/', contentRoutes);   // /testimonials, /portfolio, /blog, /faqs, /settings
router.use('/', mediaRoutes);     // /media

module.exports = router;
