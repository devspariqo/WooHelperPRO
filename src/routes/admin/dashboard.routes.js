'use strict';

const express = require('express');

const prisma = require('../../config/prisma');
const orderService = require('../../services/order.service');
const subscriptionService = require('../../services/subscription.service');
const invoiceService = require('../../services/invoice.service');
const paymentService = require('../../services/payment.service');
const audit = require('../../services/audit.service');

const { requireStaff, requirePermission, can, PERMISSIONS } = require('../../middleware/auth');
const { ORDER_STATUS, PROJECT_STATUS } = require('../../config/constants');
const fmt = require('../../utils/format');

const router = express.Router();

// Every /admin route requires a staff session.
router.use(requireStaff);

// ---------------------------------------------------------------
// GET /admin — KPI dashboard
// ---------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      customers, newCustomersThisMonth,
      ordersThisMonth, ordersPrevMonth,
      revenueThisMonth, revenuePrevMonth,
      activeSubs, mrrRows,
      pendingPayments, openTickets, newLeads,
      recentOrders, recentPayments, renewals, topPackages,
      statusGroups, projectsInFlight, unpaidInvoices,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'CUSTOMER' } }),
      prisma.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: monthStart } } }),
      prisma.order.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.order.count({ where: { createdAt: { gte: prevMonthStart, lte: prevMonthEnd } } }),
      prisma.order.aggregate({
        where: { createdAt: { gte: monthStart }, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
        _sum: { total: true },
      }),
      prisma.order.aggregate({
        where: { createdAt: { gte: prevMonthStart, lte: prevMonthEnd }, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
        _sum: { total: true },
      }),
      prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      // Recurring revenue normalised to a monthly figure so MRR is comparable
      // across monthly / quarterly / yearly plans.
      prisma.subscription.findMany({ where: { status: 'ACTIVE' }, select: { amount: true, billingCycle: true } }),
      prisma.payment.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true }, _count: true }),
      prisma.ticket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER'] } } }),
      prisma.lead.count({ where: { status: 'NEW' } }),
      prisma.order.findMany({
        include: { user: { select: { name: true, email: true } }, package: true },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      prisma.payment.findMany({
        where: { status: 'PENDING' },
        include: { user: { select: { name: true, email: true } }, invoice: true },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      subscriptionService.renewalsDue(30),
      prisma.order.groupBy({
        by: ['packageId'],
        where: { packageId: { not: null }, status: { notIn: ['CANCELLED'] } },
        _count: true,
        _sum: { total: true },
        orderBy: { _count: { packageId: 'desc' } },
        take: 5,
      }),
      prisma.order.groupBy({ by: ['status'], _count: true }),
      prisma.project.count({ where: { status: { in: ['DESIGNING', 'DEVELOPMENT', 'CLIENT_REVIEW', 'REVISION', 'TESTING'] } } }),
      prisma.invoice.aggregate({
        where: { status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
        _sum: { total: true, amountPaid: true },
        _count: true,
      }),
    ]);

    // MRR: divide each plan's amount by its cycle length in months.
    const cycleMonths = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };
    const mrr = mrrRows.reduce((sum, s) => sum + Number(s.amount) / (cycleMonths[s.billingCycle] || 1), 0);

    const packageIds = topPackages.map((t) => t.packageId).filter(Boolean);
    const packageNames = packageIds.length
      ? await prisma.package.findMany({ where: { id: { in: packageIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(packageNames.map((p) => [p.id, p.name]));

    const statusCounts = Object.fromEntries(statusGroups.map((g) => [g.status, g._count]));

    res.render('admin/dashboard', {
      title: 'Dashboard',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'dashboard',
      metaTitle: 'Admin dashboard — WooHelperPro',
      kpis: {
        customers,
        newCustomersThisMonth,
        ordersThisMonth,
        ordersPrevMonth,
        ordersChange: fmt.percentChange(ordersThisMonth, ordersPrevMonth),
        revenueThisMonth: revenueThisMonth._sum.total || 0,
        revenuePrevMonth: revenuePrevMonth._sum.total || 0,
        revenueChange: fmt.percentChange(revenueThisMonth._sum.total || 0, revenuePrevMonth._sum.total || 0),
        activeSubs,
        mrr: Math.round(mrr),
        pendingPaymentAmount: pendingPayments._sum.amount || 0,
        pendingPaymentCount: pendingPayments._count || 0,
        openTickets,
        newLeads,
        projectsInFlight,
        outstandingAmount: Math.max(0, (unpaidInvoices._sum.total || 0) - (unpaidInvoices._sum.amountPaid || 0)),
        outstandingCount: unpaidInvoices._count || 0,
      },
      statusCounts,
      orderStatuses: ORDER_STATUS,
      projectStatuses: PROJECT_STATUS,
      recentOrders: recentOrders.map(orderService.decorate),
      recentPayments,
      renewals,
      topPackages: topPackages.map((t) => ({
        name: t.packageId ? nameById.get(t.packageId) || 'Unnamed package' : 'Custom',
        count: t._count,
        revenue: t._sum.total || 0,
      })),
      todayStart,
      permissions: PERMISSIONS,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/reports — revenue analytics
// ---------------------------------------------------------------
router.get('/reports', requirePermission('reports'), async (req, res, next) => {
  try {
    const months = Math.min(24, Math.max(3, Number(req.query.months) || 12));

    const [series, payments, byDistrict, byService, topCustomers, statusGroups] = await Promise.all([
      invoiceService.monthlySeries(months),
      paymentService.summary(),
      prisma.order.groupBy({
        by: ['district'],
        _count: true,
        _sum: { total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 10,
      }),
      prisma.order.groupBy({
        by: ['serviceId'],
        where: { serviceId: { not: null } },
        _count: true,
        _sum: { total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 8,
      }),
      prisma.user.findMany({
        where: { role: 'CUSTOMER' },
        select: {
          id: true, name: true, email: true, district: true,
          orders: { select: { total: true, status: true } },
        },
        take: 100,
      }),
      prisma.order.groupBy({ by: ['status'], _count: true }),
    ]);

    const serviceIds = byService.map((s) => s.serviceId).filter(Boolean);
    const serviceNames = serviceIds.length
      ? await prisma.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true, title: true } })
      : [];
    const serviceById = new Map(serviceNames.map((s) => [s.id, s.title]));

    const rankedCustomers = topCustomers
      .map((c) => ({
        ...c,
        lifetimeValue: c.orders.reduce((sum, o) => sum + (['CANCELLED', 'REFUNDED'].includes(o.status) ? 0 : Number(o.total)), 0),
        orderCount: c.orders.length,
      }))
      .sort((a, b) => b.lifetimeValue - a.lifetimeValue)
      .slice(0, 10);

    res.render('admin/reports', {
      title: 'Reports',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'reports',
      metaTitle: 'Reports — WooHelperPro admin',
      months,
      series,
      payments,
      byDistrict,
      byService: byService.map((s) => ({
        name: s.serviceId ? serviceById.get(s.serviceId) || 'Unknown' : 'Other',
        count: s._count,
        revenue: s._sum.total || 0,
      })),
      topCustomers: rankedCustomers,
      statusCounts: Object.fromEntries(statusGroups.map((g) => [g.status, g._count])),
      orderStatuses: ORDER_STATUS,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/activity — audit trail
// ---------------------------------------------------------------
router.get('/activity', requirePermission('activity'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 50;

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        include: { user: { select: { name: true, email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.activityLog.count(),
    ]);

    res.render('admin/activity', {
      title: 'Activity log',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'activity',
      metaTitle: 'Activity log — WooHelperPro admin',
      logs,
      pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
