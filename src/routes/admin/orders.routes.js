'use strict';

const express = require('express');

const prisma = require('../../config/prisma');
const orderService = require('../../services/order.service');
const invoiceService = require('../../services/invoice.service');
const audit = require('../../services/audit.service');
const mailer = require('../../services/mailer.service');
const { parse, stringify } = require('../../utils/json');
const { requirePermission } = require('../../middleware/auth');
const { ORDER_STATUS, DISTRICTS } = require('../../config/constants');

const router = express.Router();

// ---------------------------------------------------------------
// GET /admin/orders
// ---------------------------------------------------------------
router.get('/', requirePermission('orders'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 25;
    const { status, q, priority } = req.query;

    const where = {};
    if (status) where.status = String(status);
    if (priority) where.priority = String(priority);
    if (q) {
      where.OR = [
        { orderNumber: { contains: String(q) } },
        { projectName: { contains: String(q) } },
        { businessName: { contains: String(q) } },
        { contactPhone: { contains: String(q) } },
        { user: { email: { contains: String(q) } } },
      ];
    }

    const [orders, total, statusGroups] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          package: true,
          project: true,
          _count: { select: { invoices: true, payments: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.order.count({ where }),
      prisma.order.groupBy({ by: ['status'], _count: true }),
    ]);

    res.render('admin/orders/index', {
      title: 'Orders',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'orders',
      metaTitle: 'Order management — WooHelperPro admin',
      orders: orders.map(orderService.decorate),
      statusCounts: Object.fromEntries(statusGroups.map((g) => [g.status, g._count])),
      orderStatuses: ORDER_STATUS,
      filters: { status: status || '', q: q || '', priority: priority || '' },
      pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/orders/:id
// ---------------------------------------------------------------
router.get('/:id', requirePermission('orders'), async (req, res, next) => {
  try {
    const [order, staff] = await Promise.all([
      prisma.order.findUnique({
        where: { id: req.params.id },
        include: {
          user: true,
          // `Order.serviceId` is a scalar with no `service` relation on the
          // model, so the service is reached through the package instead.
          package: { include: { service: true } },
          invoices: { include: { payments: true }, orderBy: { issueDate: 'desc' } },
          payments: { orderBy: { createdAt: 'desc' } },
          project: { include: { milestones: { orderBy: { sortOrder: 'asc' } }, manager: { select: { id: true, name: true } } } },
        },
      }),
      prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'MANAGER', 'STAFF'] }, status: 'ACTIVE' },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    if (!order) return res.status(404).render('errors/404', { title: 'Order not found' });

    res.render('admin/orders/detail', {
      title: `Order ${order.orderNumber}`,
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'orders',
      metaTitle: `Order ${order.orderNumber} — WooHelperPro admin`,
      order: orderService.decorate(order),
      selectedPages: parse(order.selectedPages),
      nextStatuses: orderService.allowedNext(order.status),
      orderStatuses: ORDER_STATUS,
      staff,
      districts: DISTRICTS,
      canDelete: ['SUPER_ADMIN', 'ADMIN'].includes(req.user.role),
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/orders/:id/status
// ---------------------------------------------------------------
router.post('/:id/status', requirePermission('orders'), async (req, res, next) => {
  try {
    const nextStatus = String(req.body.status || '').toUpperCase();
    const note = String(req.body.note || '').trim();

    if (!ORDER_STATUS[nextStatus]) {
      req.flash('error', 'Unknown status.');
      return res.redirect(`/admin/orders/${req.params.id}`);
    }

    const updated = await orderService.updateStatus(req.params.id, nextStatus, {
      note: note || null,
      actorId: req.user.id,
    });

    await audit.log(req, 'order.status_changed', {
      entityType: 'Order',
      entityId: updated.id,
      detail: `${updated.orderNumber} -> ${nextStatus}${note ? ` (${note})` : ''}`,
    });

    // Notify the customer on meaningful state changes only, to avoid noise.
    const notifyOn = ['PAYMENT_VERIFIED', 'IN_PROGRESS', 'CLIENT_REVIEW', 'COMPLETED', 'DELIVERED', 'CANCELLED', 'ON_HOLD'];
    if (notifyOn.includes(nextStatus) && updated.contactEmail) {
      mailer
        .notify('orderStatus', [updated, ORDER_STATUS[nextStatus].en], { to: updated.contactEmail })
        .catch(() => {});
    }

    req.flash('success', `Order moved to ${ORDER_STATUS[nextStatus].en}.`);
    return res.redirect(`/admin/orders/${updated.id}`);
  } catch (err) {
    if (err.status === 400) {
      req.flash('error', err.message);
      return res.redirect(`/admin/orders/${req.params.id}`);
    }
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/orders/:id/assign
// ---------------------------------------------------------------
router.post('/:id/assign', requirePermission('orders'), async (req, res, next) => {
  try {
    const assignedTo = req.body.assignedTo || null;
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { assignedTo: assignedTo || null },
    });

    // Keep the project manager in sync so the delivery tracker names an owner.
    if (order.project) {
      await prisma.project
        .update({ where: { orderId: order.id }, data: { managerId: assignedTo || null } })
        .catch(() => {});
    } else if (assignedTo) {
      await prisma.project
        .create({
          data: { orderId: order.id, userId: order.userId, name: order.projectName, managerId: assignedTo },
        })
        .catch(() => {});
    }

    await audit.log(req, 'order.assigned', {
      entityType: 'Order',
      entityId: order.id,
      detail: `Assigned to ${assignedTo || 'nobody'}`,
    });

    req.flash('success', 'Assignment updated.');
    return res.redirect(`/admin/orders/${order.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/orders/:id/notes — internal + client-visible notes
// ---------------------------------------------------------------
router.post('/:id/notes', requirePermission('orders'), async (req, res, next) => {
  try {
    const internal = String(req.body.internalNotes || '').trim();
    const client = String(req.body.clientNotes || '').trim();
    const priority = String(req.body.priority || 'NORMAL').toUpperCase();

    await prisma.order.update({
      where: { id: req.params.id },
      data: {
        internalNotes: internal || null,
        clientNotes: client || null,
        priority: ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority) ? priority : 'NORMAL',
      },
    });

    await audit.log(req, 'order.notes_updated', { entityType: 'Order', entityId: req.params.id });

    req.flash('success', 'Notes saved.');
    return res.redirect(`/admin/orders/${req.params.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/orders/:id/delivery — live URLs and handover details
// ---------------------------------------------------------------
router.post('/:id/delivery', requirePermission('orders'), async (req, res, next) => {
  try {
    const data = {
      projectUrl: String(req.body.projectUrl || '').trim() || null,
      adminUrl: String(req.body.adminUrl || '').trim() || null,
      accessNote: String(req.body.accessNote || '').trim() || null,
    };

    const order = await prisma.order.update({ where: { id: req.params.id }, data });

    await prisma.project
      .update({
        where: { orderId: order.id },
        data: { liveUrl: data.projectUrl, stagingUrl: data.adminUrl },
      })
      .catch(() => {});

    await audit.log(req, 'order.delivery_updated', { entityType: 'Order', entityId: order.id });

    req.flash('success', 'Delivery details saved. Mark the order DELIVERED to notify the customer.');
    return res.redirect(`/admin/orders/${order.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/orders/:id/milestones/:milestoneId/toggle
// ---------------------------------------------------------------
router.post('/:id/milestones/:milestoneId/toggle', requirePermission('projects'), async (req, res, next) => {
  try {
    const milestone = await prisma.projectMilestone.findUnique({ where: { id: req.params.milestoneId } });
    if (!milestone || milestone.projectId !== req.params.id) {
      // The route param is the order id in the URL; resolve via the project.
      const project = await prisma.project.findUnique({ where: { orderId: req.params.id } });
      if (!project) {
        req.flash('error', 'Project not found.');
        return res.redirect('/admin/orders');
      }

      const m = await prisma.projectMilestone.findFirst({
        where: { id: req.params.milestoneId, projectId: project.id },
      });
      if (!m) {
        req.flash('error', 'Milestone not found.');
        return res.redirect(`/admin/orders/${req.params.id}`);
      }

      const done = !m.isDone;
      await prisma.projectMilestone.update({
        where: { id: m.id },
        data: { isDone: done, completedAt: done ? new Date() : null },
      });

      await recalcProgress(project.id);
      req.flash('success', `Milestone marked ${done ? 'complete' : 'incomplete'}.`);
      return res.redirect(`/admin/orders/${req.params.id}`);
    }

    const done = !milestone.isDone;
    await prisma.projectMilestone.update({
      where: { id: milestone.id },
      data: { isDone: done, completedAt: done ? new Date() : null },
    });

    await recalcProgress(milestone.projectId);
    req.flash('success', `Milestone marked ${done ? 'complete' : 'incomplete'}.`);
    return res.redirect(`/admin/orders/${req.params.id}`);
  } catch (err) {
    return next(err);
  }
});

/** Derive project progress from completed milestones. */
async function recalcProgress(projectId) {
  const milestones = await prisma.projectMilestone.findMany({ where: { projectId } });
  if (!milestones.length) return;

  const done = milestones.filter((m) => m.isDone).length;
  const progress = Math.round((done / milestones.length) * 100);

  await prisma.project.update({ where: { id: projectId }, data: { progress } }).catch(() => {});
}

// ---------------------------------------------------------------
// POST /admin/orders/:id/delete — hard delete, admin only
// ---------------------------------------------------------------
router.post('/:id/delete', requirePermission('ordersDelete'), async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { payments: true } } },
    });

    if (!order) {
      req.flash('error', 'Order not found.');
      return res.redirect('/admin/orders');
    }

    // Orders with money attached are never deleted — cancel them instead so the
    // audit trail and revenue reconciliation stay intact.
    if (order._count.payments > 0 || Number(order.paidAmount) > 0) {
      req.flash('error', 'This order has payments recorded. Cancel it instead of deleting, so the financial trail is preserved.');
      return res.redirect(`/admin/orders/${order.id}`);
    }

    await prisma.order.delete({ where: { id: order.id } });
    await audit.log(req, 'order.deleted', {
      entityType: 'Order',
      entityId: order.id,
      detail: `${order.orderNumber} — ${order.projectName}`,
    });

    req.flash('success', `Order ${order.orderNumber} deleted.`);
    return res.redirect('/admin/orders');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/orders/:id/invoice — raise an additional invoice
// ---------------------------------------------------------------
router.post('/:id/invoice', requirePermission('invoices'), async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) {
      req.flash('error', 'Order not found.');
      return res.redirect('/admin/orders');
    }

    const subtotal = Number(req.body.subtotal) || 0;
    const discount = Number(req.body.discount) || 0;
    const tax = Number(req.body.tax) || 0;
    const total = Number(req.body.total) || subtotal - discount + tax;

    if (total <= 0) {
      req.flash('error', 'Invoice total must be greater than zero.');
      return res.redirect(`/admin/orders/${order.id}`);
    }

    const invoice = await invoiceService.createInvoice({
      userId: order.userId,
      orderId: order.id,
      title: String(req.body.title || `Additional charge — ${order.projectName}`).trim(),
      description: String(req.body.description || '').trim() || null,
      subtotal, discount, tax, total,
      dueDate: req.body.dueDate ? new Date(req.body.dueDate) : new Date(Date.now() + 7 * 86400000),
      status: 'SENT',
    });

    await audit.log(req, 'invoice.created', {
      entityType: 'Invoice',
      entityId: invoice.id,
      detail: `${invoice.invoiceNumber} — ৳${total} for order ${order.orderNumber}`,
    });

    if (order.contactEmail) {
      mailer.notify('invoice', [invoice], { to: order.contactEmail }).catch(() => {});
    }

    req.flash('success', `Invoice ${invoice.invoiceNumber} created.`);
    return res.redirect(`/admin/orders/${order.id}`);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
