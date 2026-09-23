'use strict';

const express = require('express');

const prisma = require('../../config/prisma');
const sec = require('../../utils/security');
const audit = require('../../services/audit.service');
const mailer = require('../../services/mailer.service');
const ids = require('../../utils/ids');
const { parse } = require('../../utils/json');
const { requirePermission } = require('../../middleware/auth');
const { ROLES, DISTRICTS, STAFF_ROLES } = require('../../config/constants');

const router = express.Router();

// ---------------------------------------------------------------
// GET /admin/users — customer + staff directory
// ---------------------------------------------------------------
router.get('/', requirePermission('users'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 25;
    const q = String(req.query.q || '').trim();
    const role = String(req.query.role || '').trim();
    const status = String(req.query.status || '').trim();

    const where = {};
    if (role) where.role = role;

    // Audience groups. "Staff" spans five roles, which a single `role` value
    // cannot express, so the tab passes group=staff instead. STAFF_ROLES is the
    // one definition of who counts as staff -- duplicating the list in the view
    // would let the two drift.
    const group = String(req.query.group || '').trim();
    if (!role && group === 'staff') where.role = { in: STAFF_ROLES };
    if (!role && group === 'customers') where.role = 'CUSTOMER';

    if (status) where.status = status;
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
        { company: { contains: q } },
      ];
    }

    const [users, total, counts] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          _count: { select: { orders: true, subscriptions: true, tickets: true } },
          orders: { select: { total: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.user.count({ where }),
      prisma.user.groupBy({ by: ['role'], _count: true }),
    ]);

    res.render('admin/users/index', {
      title: 'Users',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'users',
      metaTitle: 'User management — WooHelperPro admin',
      users: users.map((u) => ({
        ...u,
        lifetimeValue: u.orders.reduce(
          (sum, o) => sum + (['CANCELLED', 'REFUNDED'].includes(o.status) ? 0 : Number(o.total)),
          0,
        ),
      })),
      roleCounts: Object.fromEntries(counts.map((c) => [c.role, c._count])),
      filters: { q, role, status, group },
      pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
      roles: ROLES,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/users/new — create a staff or customer account
// ---------------------------------------------------------------
router.get('/new', requirePermission('users'), (req, res) => {
  res.render('admin/users/form', {
    title: 'Add user',
    layout: 'layouts/dashboard',
    bodyClass: 'admin-page',
    panel: 'admin',
    active: 'users',
    metaTitle: 'Add user — WooHelperPro admin',
    user: null,
    roles: ROLES,
    districts: DISTRICTS,
    canAssignRoles: ['SUPER_ADMIN'].includes(req.user.role),
  });
});

router.post('/', requirePermission('users'), async (req, res, next) => {
  try {
    const {
      name = '', email = '', phone = '', password = '', role = 'CUSTOMER',
      company = '', district = '', address = '', status = 'ACTIVE', adminNotes = '',
    } = req.body;

    const cleanEmail = String(email).trim().toLowerCase();
    const renderError = (error) =>
      res.status(400).render('admin/users/form', {
        title: 'Add user',
        layout: 'layouts/dashboard',
        bodyClass: 'admin-page',
        panel: 'admin',
        active: 'users',
        metaTitle: 'Add user — WooHelperPro admin',
        error,
        user: { ...req.body, id: null },
        roles: ROLES,
        districts: DISTRICTS,
        canAssignRoles: ['SUPER_ADMIN'].includes(req.user.role),
      });

    if (String(name).trim().length < 2) return renderError('Enter the user\'s full name.');
    if (!sec.isValidEmail(cleanEmail)) return renderError('Enter a valid email address.');

    const check = sec.validatePassword(password);
    if (!check.valid) return renderError(check.errors.join(' '));

    const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existing) return renderError('A user with this email already exists.');

    // Only a super admin may mint privileged accounts.
    let finalRole = 'CUSTOMER';
    if (['SUPER_ADMIN'].includes(req.user.role) && ROLES[role]) finalRole = role;

    const normalizedPhone = phone ? sec.normalizeBdPhone(phone) : null;
    if (phone && !normalizedPhone) return renderError('Enter a valid Bangladeshi mobile number.');

    const user = await prisma.user.create({
      data: {
        name: String(name).trim(),
        email: cleanEmail,
        phone: normalizedPhone,
        passwordHash: await sec.hash(password),
        role: finalRole,
        status: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'].includes(status) ? status : 'ACTIVE',
        company: String(company).trim() || null,
        district: String(district).trim() || null,
        address: String(address).trim() || null,
        avatarUrl: String(req.body.avatarUrl || '').trim() || null,
        adminNotes: String(adminNotes).trim() || null,
        emailVerified: true, // created by staff
      },
    });

    await audit.log(req, 'user.created', {
      entityType: 'User',
      entityId: user.id,
      detail: `${user.email} created as ${finalRole}`,
    });

    mailer.notify('welcome', [user], { to: user.email }).catch(() => {});

    req.flash('success', `${user.name} has been created as ${ROLES[finalRole]}.`);
    return res.redirect(`/admin/users/${user.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/users/:id — 360° customer view
// ---------------------------------------------------------------
router.get('/:id', requirePermission('users'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        orders: {
          include: { package: true, project: true },
          orderBy: { createdAt: 'desc' },
        },
        subscriptions: { include: { package: true }, orderBy: { createdAt: 'desc' } },
        invoices: { orderBy: { issueDate: 'desc' } },
        payments: { orderBy: { createdAt: 'desc' }, take: 20 },
        tickets: { orderBy: { createdAt: 'desc' }, take: 10 },
        notes: { orderBy: { createdAt: 'desc' } },
        activityLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    if (!user) return res.status(404).render('errors/404', { title: 'User not found' });

    const lifetimeValue = user.orders
      .filter((o) => !['CANCELLED', 'REFUNDED'].includes(o.status))
      .reduce((sum, o) => sum + Number(o.total), 0);

    const outstanding = user.invoices
      .filter((i) => ['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status))
      .reduce((sum, i) => sum + (Number(i.total) - Number(i.amountPaid)), 0);

    res.render('admin/users/detail', {
      title: user.name,
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'users',
      metaTitle: `${user.name} — WooHelperPro admin`,
      user,
      lifetimeValue,
      outstanding: Math.max(0, outstanding),
      roles: ROLES,
      districts: DISTRICTS,
      canAssignRoles: ['SUPER_ADMIN'].includes(req.user.role),
      canDelete: ['SUPER_ADMIN'].includes(req.user.role),
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/users/:id/edit
// ---------------------------------------------------------------
router.get('/:id/edit', requirePermission('users'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).render('errors/404', { title: 'User not found' });

    res.render('admin/users/form', {
      title: `Edit ${user.name}`,
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'users',
      metaTitle: `Edit ${user.name} — WooHelperPro admin`,
      user,
      roles: ROLES,
      districts: DISTRICTS,
      canAssignRoles: ['SUPER_ADMIN'].includes(req.user.role),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id', requirePermission('users'), async (req, res, next) => {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).render('errors/404', { title: 'User not found' });

    const { name = '', email = '', phone = '', role, status = 'ACTIVE', company = '', district = '', address = '', adminNotes = '' } = req.body;

    const cleanEmail = String(email).trim().toLowerCase();
    if (!sec.isValidEmail(cleanEmail)) {
      req.flash('error', 'Enter a valid email address.');
      return res.redirect(`/admin/users/${existing.id}/edit`);
    }

    const clash = await prisma.user.findFirst({ where: { email: cleanEmail, id: { not: existing.id } } });
    if (clash) {
      req.flash('error', 'Another user already uses that email address.');
      return res.redirect(`/admin/users/${existing.id}/edit`);
    }

    const normalizedPhone = phone ? sec.normalizeBdPhone(phone) : null;
    if (phone && !normalizedPhone) {
      req.flash('error', 'Enter a valid Bangladeshi mobile number.');
      return res.redirect(`/admin/users/${existing.id}/edit`);
    }

    const data = {
      name: String(name).trim() || existing.name,
      email: cleanEmail,
      phone: normalizedPhone,
      company: String(company).trim() || null,
      district: String(district).trim() || null,
      address: String(address).trim() || null,
      avatarUrl: String(req.body.avatarUrl || '').trim() || null,
      adminNotes: String(adminNotes).trim() || null,
      status: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'].includes(status) ? status : existing.status,
    };

    // Role changes are super-admin only, and you cannot demote yourself —
    // that is how you lock the last owner out of the panel.
    if (req.user.role === 'SUPER_ADMIN' && role && ROLES[role] && role !== existing.role) {
      if (existing.id === req.user.id) {
        req.flash('error', 'You cannot change your own role.');
        return res.redirect(`/admin/users/${existing.id}/edit`);
      }
      data.role = role;
    }

    await prisma.user.update({ where: { id: existing.id }, data });

    await audit.log(req, 'user.updated', {
      entityType: 'User',
      entityId: existing.id,
      detail: `Updated ${existing.email}${data.role && data.role !== existing.role ? ` (role ${existing.role} -> ${data.role})` : ''}`,
    });

    req.flash('success', 'User updated.');
    return res.redirect(`/admin/users/${existing.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/users/:id/status — suspend / activate
// ---------------------------------------------------------------
router.post('/:id/status', requirePermission('users'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      req.flash('error', 'User not found.');
      return res.redirect('/admin/users');
    }

    if (user.id === req.user.id) {
      req.flash('error', 'You cannot change your own account status.');
      return res.redirect(`/admin/users/${user.id}`);
    }

    if (user.role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      req.flash('error', 'Only a super admin can suspend another super admin.');
      return res.redirect(`/admin/users/${user.id}`);
    }

    const status = String(req.body.status || '').toUpperCase();
    if (!['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status)) {
      req.flash('error', 'Invalid status.');
      return res.redirect(`/admin/users/${user.id}`);
    }

    await prisma.user.update({ where: { id: user.id }, data: { status } });

    await audit.log(req, 'user.status_changed', {
      entityType: 'User',
      entityId: user.id,
      detail: `${user.email}: ${user.status} -> ${status}`,
    });

    req.flash('success', `${user.name} is now ${status.toLowerCase()}.`);
    return res.redirect(`/admin/users/${user.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/users/:id/reset-password — issue a temporary password
// ---------------------------------------------------------------
router.post('/:id/reset-password', requirePermission('users'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      req.flash('error', 'User not found.');
      return res.redirect('/admin/users');
    }

    const tempPassword = `Whp-${ids.token(8)}`;
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await sec.hash(tempPassword) },
    });

    await audit.log(req, 'user.password_reset', {
      entityType: 'User',
      entityId: user.id,
      detail: `Temporary password issued for ${user.email}`,
    });

    // Shown once in the flash message: there is no email delivery configured
    // in this deployment, so the operator relays it out of band.
    req.flash(
      'success',
      `Temporary password for ${user.email}: ${tempPassword} — share it over a secure channel and ask them to change it.`,
    );
    return res.redirect(`/admin/users/${user.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/users/:id/kyc — verify business documents
// ---------------------------------------------------------------
router.post('/:id/kyc', requirePermission('users'), async (req, res, next) => {
  try {
    const status = String(req.body.kycStatus || '').toUpperCase();
    if (!['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED'].includes(status)) {
      req.flash('error', 'Invalid KYC status.');
      return res.redirect(`/admin/users/${req.params.id}`);
    }

    await prisma.user.update({ where: { id: req.params.id }, data: { kycStatus: status } });
    await audit.log(req, 'user.kyc_changed', { entityType: 'User', entityId: req.params.id, detail: `KYC -> ${status}` });

    req.flash('success', `KYC marked as ${status.toLowerCase().replace(/_/g, ' ')}.`);
    return res.redirect(`/admin/users/${req.params.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/users/:id/notes — internal note
// ---------------------------------------------------------------
router.post('/:id/notes', requirePermission('users'), async (req, res, next) => {
  try {
    const body = String(req.body.body || '').trim();
    if (body.length < 2) {
      req.flash('error', 'Write something before saving a note.');
      return res.redirect(`/admin/users/${req.params.id}`);
    }

    await prisma.clientNote.create({
      data: { userId: req.params.id, authorId: req.user.id, body },
    });

    await audit.log(req, 'user.note_added', { entityType: 'User', entityId: req.params.id });

    req.flash('success', 'Note added.');
    return res.redirect(`/admin/users/${req.params.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/users/:id/delete — super admin only, guarded
// ---------------------------------------------------------------
router.post('/:id/delete', requirePermission('usersDelete'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { orders: true, subscriptions: true } } },
    });

    if (!user) {
      req.flash('error', 'User not found.');
      return res.redirect('/admin/users');
    }
    if (user.id === req.user.id) {
      req.flash('error', 'You cannot delete your own account.');
      return res.redirect(`/admin/users/${user.id}`);
    }
    if (user.role === 'SUPER_ADMIN') {
      const superAdmins = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
      if (superAdmins <= 1) {
        req.flash('error', 'This is the only super admin account. Deleting it would lock everyone out.');
        return res.redirect(`/admin/users/${user.id}`);
      }
    }

    // Customers with financial history are archived, not deleted — deleting
    // would cascade away orders and invoices and corrupt the revenue reports.
    if (user._count.orders > 0 || user._count.subscriptions > 0) {
      await prisma.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
      await audit.log(req, 'user.archived', {
        entityType: 'User',
        entityId: user.id,
        detail: `${user.email} has ${user._count.orders} orders — archived instead of deleted`,
      });
      req.flash(
        'warning',
        `${user.name} has order history, so the account was deactivated instead of deleted. Financial records are preserved.`,
      );
      return res.redirect(`/admin/users/${user.id}`);
    }

    await prisma.user.delete({ where: { id: user.id } });
    await audit.log(req, 'user.deleted', {
      entityType: 'User',
      entityId: user.id,
      detail: `Deleted ${user.email}`,
    });

    req.flash('success', `${user.name} has been deleted.`);
    return res.redirect('/admin/users');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
