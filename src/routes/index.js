'use strict';

/**
 * Route registry. Mount order matters: the webhook routes must be registered
 * before anything else that could consume the body, and the API health probe
 * is public.
 */

const config = require('../config');

const authRoutes = require('./auth.routes');
const publicRoutes = require('./public.routes');
const accountRoutes = require('./account.routes');
const adminRoutes = require('./admin');
const paymentRoutes = require('./payment.routes');
const apiRoutes = require('./api.routes');
const seoRoutes = require('./seo.routes');

module.exports = function registerRoutes(app) {
  // Health probe — no auth, no DB dependency beyond a trivial query.
  app.get('/api/health', async (req, res) => {
    const prisma = require('../config/prisma');
    let db = 'unknown';
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = 'connected';
    } catch {
      db = 'unavailable';
    }
    res.json({
      ok: db === 'connected',
      app: config.appName,
      env: config.env,
      database: db,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/payments', paymentRoutes);
  app.use('/api', apiRoutes);

  // /sitemap.xml and /robots.txt must sit at the origin root, so this is mounted
  // before the catch-all public router.
  app.use('/', seoRoutes);

  app.use('/', authRoutes);
  app.use('/account', accountRoutes);
  app.use('/admin', adminRoutes);
  app.use('/', publicRoutes);
};
