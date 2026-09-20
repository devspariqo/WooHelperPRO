'use strict';

const config = require('./config');
const prisma = require('./config/prisma');
const createApp = require('./app');
const registerRoutes = require('./routes');

const app = createApp();

registerRoutes(app);

// ---------------------------------------------------------------
// 404
// ---------------------------------------------------------------
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  return res.status(404).render('errors/404', { title: 'Page not found' });
});

// ---------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isServerError = status >= 500;

  if (isServerError) {
    console.error(`[error] ${req.method} ${req.originalUrl} -> ${status}`);
    console.error(err.stack || err.message);
  }

  const message = isServerError && config.isProd
    ? 'Something went wrong on our side. Our team has been notified.'
    : err.message || 'Unexpected error';

  if (req.path.startsWith('/api/') || req.xhr) {
    return res.status(status).json({ ok: false, error: message });
  }

  return res.status(status).render('errors/500', {
    title: isServerError ? 'Server error' : 'Request error',
    status,
    message,
    stack: config.isProd ? null : err.stack,
  });
});

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------
const server = app.listen(config.port, () => {
  const base = `http://localhost:${config.port}`;
  console.log('');
  console.log('  ⚡ WooHelperPro is running');
  console.log(`     Public site   ${base}`);
  console.log(`     Customer      ${base}/account`);
  console.log(`     Admin panel   ${base}/admin`);
  console.log(`     Health        ${base}/api/health`);
  console.log(`     Environment   ${config.env}`);
  console.log('');
  console.log('  Admin bootstrap:  ADMIN_EMAIL / ADMIN_PASSWORD in .env');
  console.log('  Run `npm run db:seed` to create the demo dataset.');
  console.log('');
});

// ---------------------------------------------------------------
// Graceful shutdown — close the DB pool so SQLite releases its lock file.
// ---------------------------------------------------------------
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${signal}] shutting down...`);

  const force = setTimeout(() => {
    console.error('[shutdown] forced exit after 10s');
    process.exit(1);
  }, 10000);
  force.unref();

  server.close(async () => {
    try {
      await prisma.$disconnect();
    } catch (err) {
      console.error('[shutdown] prisma disconnect failed:', err.message);
    }
    console.log('[shutdown] complete');
    process.exit(0);
  });
}

['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  shutdown('uncaughtException');
});

module.exports = { app, server };
