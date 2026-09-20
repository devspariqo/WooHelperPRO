'use strict';

const express = require('express');

const prisma = require('../../config/prisma');
const audit = require('../../services/audit.service');
const ids = require('../../utils/ids');
const { requirePermission } = require('../../middleware/auth');
const { TICKET_STATUS, LEAD_STATUS, DISTRICTS, TICKET_CATEGORIES } = require('../../config/constants');

const router = express.Router();

// ===============================================================
// SUPPORT TICKETS
// ===============================================================

router.get('/tickets', requirePermission('tickets'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 25;
    const { status, category, q } = req.query;

    const where = {};
    if (status) where.status = String(status);
    if (category) where.category = String(category);
    if (q) {
      where.OR = [
        { ticketNumber: { contains: String(q) } },
        { subject: { contains: String(q) } },
        { user: { email: { contains: String(q) } } },
      ];
    }

    const [tickets, total, statusGroups] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          _count: { select: { replies: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.ticket.count({ where }),
      prisma.ticket.groupBy({ by: ['status'], _count: true }),
    ]);

    res.render('admin/tickets/index', {
      title: 'Support tickets',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'tickets',
      metaTitle: 'Support tickets — WooHelperPro admin',
      tickets,
      statusCounts: Object.fromEntries(statusGroups.map((g) => [g.status, g._count])),
      ticketStatuses: TICKET_STATUS,
      categories: TICKET_CATEGORIES,
      filters: { status: status || '', category: category || '', q: q || '' },
      pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/tickets/:id', requirePermission('tickets'), async (req, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: {
        user: true,
        replies: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { name: true, role: true } } },
        },
      },
    });

    if (!ticket) return res.status(404).render('errors/404', { title: 'Ticket not found' });

    res.render('admin/tickets/detail', {
      title: ticket.subject,
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'tickets',
      metaTitle: `${ticket.ticketNumber} — WooHelperPro admin`,
      ticket,
      ticketStatuses: TICKET_STATUS,
      categories: TICKET_CATEGORIES,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/tickets/:id/reply', requirePermission('tickets'), async (req, res, next) => {
  try {
    const body = String(req.body.body || '').trim();
    const status = String(req.body.status || '').toUpperCase();

    if (body.length < 2) {
      req.flash('error', 'Write a reply before sending.');
      return res.redirect(`/admin/tickets/${req.params.id}`);
    }

    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
    if (!ticket) {
      req.flash('error', 'Ticket not found.');
      return res.redirect('/admin/tickets');
    }

    await prisma.ticketReply.create({
      data: { ticketId: ticket.id, userId: req.user.id, body, isStaff: true },
    });

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: TICKET_STATUS[status] ? status : 'WAITING_CUSTOMER',
        assignedTo: ticket.assignedTo || req.user.id,
        updatedAt: new Date(),
      },
    });

    await audit.log(req, 'ticket.replied', {
      entityType: 'Ticket',
      entityId: ticket.id,
      detail: `${ticket.ticketNumber} -> ${status || 'WAITING_CUSTOMER'}`,
    });

    req.flash('success', 'Reply sent to the customer.');
    return res.redirect(`/admin/tickets/${ticket.id}`);
  } catch (err) {
    return next(err);
  }
});

router.post('/tickets/:id/status', requirePermission('tickets'), async (req, res, next) => {
  try {
    const status = String(req.body.status || '').toUpperCase();
    if (!TICKET_STATUS[status]) {
      req.flash('error', 'Unknown ticket status.');
      return res.redirect(`/admin/tickets/${req.params.id}`);
    }

    await prisma.ticket.update({
      where: { id: req.params.id },
      data: { status, closedAt: ['CLOSED', 'RESOLVED'].includes(status) ? new Date() : null },
    });

    await audit.log(req, 'ticket.status_changed', {
      entityType: 'Ticket',
      entityId: req.params.id,
      detail: `-> ${status}`,
    });

    req.flash('success', `Ticket marked ${status.toLowerCase().replace('_', ' ')}.`);
    return res.redirect(`/admin/tickets/${req.params.id}`);
  } catch (err) {
    return next(err);
  }
});

// ===============================================================
// SALES LEADS
// ===============================================================

router.get('/leads', requirePermission('leads'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 25;
    const { status, q } = req.query;

    const where = {};
    if (status) where.status = String(status);
    if (q) {
      where.OR = [
        { name: { contains: String(q) } },
        { phone: { contains: String(q) } },
        { email: { contains: String(q) } },
        { company: { contains: String(q) } },
      ];
    }

    const [leads, total, statusGroups] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.lead.count({ where }),
      prisma.lead.groupBy({ by: ['status'], _count: true }),
    ]);

    res.render('admin/leads/index', {
      title: 'Sales leads',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'leads',
      metaTitle: 'Sales leads — WooHelperPro admin',
      leads,
      leadStatuses: LEAD_STATUS,
      statusCounts: Object.fromEntries(statusGroups.map((g) => [g.status, g._count])),
      filters: { status: status || '', q: q || '' },
      pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/leads', requirePermission('leads'), async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim();
    if (name.length < 2 || phone.length < 6) {
      req.flash('error', 'A lead needs at least a name and a phone number.');
      return res.redirect('/admin/leads');
    }

    await prisma.lead.create({
      data: {
        name,
        phone,
        email: String(req.body.email || '').trim() || null,
        company: String(req.body.company || '').trim() || null,
        district: String(req.body.district || '').trim() || null,
        serviceType: String(req.body.serviceType || '').trim() || null,
        budget: String(req.body.budget || '').trim() || null,
        message: String(req.body.message || '').trim() || null,
        source: 'MANUAL',
        status: 'NEW',
      },
    });

    req.flash('success', 'Lead added.');
    return res.redirect('/admin/leads');
  } catch (err) {
    return next(err);
  }
});

router.post('/leads/:id', requirePermission('leads'), async (req, res, next) => {
  try {
    const status = String(req.body.status || '').toUpperCase();

    await prisma.lead.update({
      where: { id: req.params.id },
      data: {
        status: LEAD_STATUS[status] ? status : undefined,
        notes: String(req.body.notes || '').trim() || null,
        followUpAt: req.body.followUpAt ? new Date(req.body.followUpAt) : null,
        assignedTo: String(req.body.assignedTo || '').trim() || null,
      },
    });

    await audit.log(req, 'lead.updated', { entityType: 'Lead', entityId: req.params.id, detail: `-> ${status}` });

    req.flash('success', 'Lead updated.');
    return res.redirect('/admin/leads');
  } catch (err) {
    return next(err);
  }
});

router.post('/leads/:id/convert', requirePermission('leads'), async (req, res, next) => {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) {
      req.flash('error', 'Lead not found.');
      return res.redirect('/admin/leads');
    }

    // Converting creates a real customer account keyed on the lead's phone.
    const email = lead.email || `${lead.phone.replace(/\D/g, '')}@lead.woohelperpro.local`;
    let user = await prisma.user.findUnique({ where: { email } });

    const sec = require('../../utils/security');

    if (!user) {
      const tempPassword = `Whp-${ids.token(8)}`;
      user = await prisma.user.create({
        data: {
          name: lead.name,
          email,
          phone: lead.phone,
          passwordHash: await sec.hash(tempPassword),
          role: 'CUSTOMER',
          status: 'ACTIVE',
          district: lead.district,
          company: lead.company,
          adminNotes: `Converted from lead ${lead.id}. Temporary password: ${tempPassword}`,
        },
      });
    }

    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'CONVERTED' } });

    await audit.log(req, 'lead.converted', {
      entityType: 'Lead',
      entityId: lead.id,
      detail: `${lead.name} -> customer ${user.email}`,
    });

    req.flash('success', `Lead converted. Customer account created for ${user.email}.`);
    return res.redirect(`/admin/users/${user.id}`);
  } catch (err) {
    return next(err);
  }
});

router.post('/leads/:id/delete', requirePermission('leads'), async (req, res, next) => {
  try {
    await prisma.lead.delete({ where: { id: req.params.id } });
    await audit.log(req, 'lead.deleted', { entityType: 'Lead', entityId: req.params.id });
    req.flash('success', 'Lead deleted.');
    return res.redirect('/admin/leads');
  } catch (err) {
    return next(err);
  }
});

// ===============================================================
// COUPONS
// ===============================================================

router.get('/coupons', requirePermission('coupons'), async (req, res, next) => {
  try {
    const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });

    res.render('admin/coupons/index', {
      title: 'Coupons',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'coupons',
      metaTitle: 'Coupons — WooHelperPro admin',
      coupons: coupons.map((c) => ({
        ...c,
        expired: c.expiresAt ? c.expiresAt < new Date() : false,
        remaining: c.maxUses > 0 ? Math.max(0, c.maxUses - c.usedCount) : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/coupons', requirePermission('coupons'), async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (code.length < 3) {
      req.flash('error', 'Coupon code must be at least 3 characters.');
      return res.redirect('/admin/coupons');
    }

    const clash = await prisma.coupon.findUnique({ where: { code } });
    if (clash) {
      req.flash('error', `Coupon ${code} already exists.`);
      return res.redirect('/admin/coupons');
    }

    const discountType = req.body.discountType === 'FIXED' ? 'FIXED' : 'PERCENT';
    const discountValue = Number(req.body.discountValue) || 0;

    if (discountValue <= 0) {
      req.flash('error', 'Discount value must be greater than zero.');
      return res.redirect('/admin/coupons');
    }
    if (discountType === 'PERCENT' && discountValue > 100) {
      req.flash('error', 'A percentage discount cannot exceed 100%.');
      return res.redirect('/admin/coupons');
    }

    const coupon = await prisma.coupon.create({
      data: {
        code,
        description: String(req.body.description || '').trim() || null,
        discountType,
        discountValue,
        minOrder: Number(req.body.minOrder) || 0,
        maxUses: Number(req.body.maxUses) || 0,
        appliesTo: ['ALL', 'PACKAGE', 'SERVICE', 'SUBSCRIPTION'].includes(req.body.appliesTo)
          ? req.body.appliesTo
          : 'ALL',
        isActive: req.body.isActive !== 'off',
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
      },
    });

    await audit.log(req, 'coupon.created', { entityType: 'Coupon', entityId: coupon.id, detail: code });

    req.flash('success', `Coupon ${code} created.`);
    return res.redirect('/admin/coupons');
  } catch (err) {
    return next(err);
  }
});

router.post('/coupons/:id/toggle', requirePermission('coupons'), async (req, res, next) => {
  try {
    const coupon = await prisma.coupon.findUnique({ where: { id: req.params.id } });
    if (!coupon) {
      req.flash('error', 'Coupon not found.');
      return res.redirect('/admin/coupons');
    }

    await prisma.coupon.update({ where: { id: coupon.id }, data: { isActive: !coupon.isActive } });

    req.flash('success', `Coupon ${coupon.code} is now ${!coupon.isActive ? 'active' : 'inactive'}.`);
    return res.redirect('/admin/coupons');
  } catch (err) {
    return next(err);
  }
});

router.post('/coupons/:id/delete', requirePermission('coupons'), async (req, res, next) => {
  try {
    await prisma.coupon.delete({ where: { id: req.params.id } });
    await audit.log(req, 'coupon.deleted', { entityType: 'Coupon', entityId: req.params.id });
    req.flash('success', 'Coupon deleted.');
    return res.redirect('/admin/coupons');
  } catch (err) {
    return next(err);
  }
});

// ===============================================================
// PROJECTS
// ===============================================================

router.get('/projects', requirePermission('projects'), async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status) where.status = String(status);

    const projects = await prisma.project.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        manager: { select: { id: true, name: true } },
        order: { select: { id: true, orderNumber: true, total: true } },
        milestones: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const { PROJECT_STATUS } = require('../../config/constants');

    res.render('admin/projects/index', {
      title: 'Projects',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'projects',
      metaTitle: 'Projects — WooHelperPro admin',
      projects,
      projectStatuses: PROJECT_STATUS,
      filters: { status: status || '' },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/projects/:id', requirePermission('projects'), async (req, res, next) => {
  try {
    const { PROJECT_STATUS } = require('../../config/constants');
    const status = String(req.body.status || '').toUpperCase();

    const data = {
      currentStage: String(req.body.currentStage || '').trim() || null,
      stagingUrl: String(req.body.stagingUrl || '').trim() || null,
      liveUrl: String(req.body.liveUrl || '').trim() || null,
      repoUrl: String(req.body.repoUrl || '').trim() || null,
      techStack: String(req.body.techStack || '').trim() || null,
      targetDate: req.body.targetDate ? new Date(req.body.targetDate) : null,
    };

    if (PROJECT_STATUS[status]) {
      data.status = status;
      data.progress = PROJECT_STATUS[status].progress;
      if (status === 'LAUNCHED') data.launchedAt = new Date();
    }

    await prisma.project.update({ where: { id: req.params.id }, data });

    await audit.log(req, 'project.updated', {
      entityType: 'Project',
      entityId: req.params.id,
      detail: status ? `status -> ${status}` : 'details updated',
    });

    req.flash('success', 'Project updated.');
    return res.redirect('/admin/projects');
  } catch (err) {
    return next(err);
  }
});

router.post('/projects/:id/milestones', requirePermission('projects'), async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    if (title.length < 2) {
      req.flash('error', 'Give the milestone a title.');
      return res.redirect('/admin/projects');
    }

    const count = await prisma.projectMilestone.count({ where: { projectId: req.params.id } });

    await prisma.projectMilestone.create({
      data: {
        projectId: req.params.id,
        title,
        description: String(req.body.description || '').trim() || null,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
        sortOrder: count + 1,
      },
    });

    req.flash('success', 'Milestone added.');
    return res.redirect('/admin/projects');
  } catch (err) {
    return next(err);
  }
});

router.post('/projects/milestones/:milestoneId/toggle', requirePermission('projects'), async (req, res, next) => {
  try {
    const milestone = await prisma.projectMilestone.findUnique({ where: { id: req.params.milestoneId } });
    if (!milestone) {
      req.flash('error', 'Milestone not found.');
      return res.redirect('/admin/projects');
    }

    const done = !milestone.isDone;
    await prisma.projectMilestone.update({
      where: { id: milestone.id },
      data: { isDone: done, completedAt: done ? new Date() : null },
    });

    const all = await prisma.projectMilestone.findMany({ where: { projectId: milestone.projectId } });
    const progress = Math.round((all.filter((m) => m.isDone).length / all.length) * 100);
    await prisma.project.update({ where: { id: milestone.projectId }, data: { progress } });

    req.flash('success', `Milestone marked ${done ? 'complete' : 'incomplete'}.`);
    return res.redirect('/admin/projects');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
