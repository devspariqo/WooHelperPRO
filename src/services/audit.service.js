'use strict';

const prisma = require('../config/prisma');

/**
 * Audit trail. Every state-changing admin action writes a row so "who changed
 * this order's status and when" is answerable.
 *
 * Fire-and-forget by design: an audit write must never break the user's action.
 */
async function log(req, action, options = {}) {
  const { entityType, entityId, detail, userId } = options;
  try {
    await prisma.activityLog.create({
      data: {
        userId: userId !== undefined ? userId : req.user?.id ?? null,
        action,
        entityType: entityType || null,
        entityId: entityId ? String(entityId) : null,
        detail: detail ? String(detail).slice(0, 500) : null,
        ip: clientIp(req),
        userAgent: String(req.get?.('user-agent') || '').slice(0, 200) || null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write activity log:', err.message);
  }
}

/** Real client IP behind a reverse proxy (Hostinger/Nginx). */
function clientIp(req) {
  const forwarded = req.get?.('x-forwarded-for');
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

/** Fire-and-forget variant for use inside non-async handlers. */
function logAsync(req, action, options) {
  log(req, action, options).catch(() => {});
}

module.exports = { log, logAsync, clientIp };
