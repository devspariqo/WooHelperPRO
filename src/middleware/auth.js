'use strict';

const prisma = require('../config/prisma');
const { ROLES } = require('../config/constants');

/**
 * Session -> request user hydration.
 * Runs on every request. Loads the user fresh from the DB so a role change or
 * suspension takes effect immediately instead of at next login.
 */
async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  res.locals.isAuthenticated = false;
  res.locals.isStaff = false;
  res.locals.isAdmin = false;
  res.locals.can = () => false;

  const userId = req.session && req.session.userId;
  if (!userId) return next();

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        status: true, avatarUrl: true, company: true, district: true, address: true,
        designation: true, kycStatus: true, emailVerified: true, createdAt: true,
      },
    });

    // Session points at a deleted user, or the account was suspended mid-session.
    if (!user || user.status === 'SUSPENDED' || user.status === 'INACTIVE') {
      req.session.destroy(() => {});
      res.locals.flashError = user ? 'Your account has been suspended. Contact support.' : 'Session expired.';
      return next();
    }

    req.user = user;
    res.locals.currentUser = user;
    res.locals.isAuthenticated = true;
    res.locals.isStaff = user.role !== 'CUSTOMER';
    res.locals.isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(user.role);

    // The view helper. Every caller in views/ passes a PERMISSION name from the
    // matrix below -- can('dashboard'), can('orders'), can('settings'), and so on.
    //
    // This used to be implemented inline as `(roles) => [roles].includes(user.role)`,
    // which compared the permission name against the ROLE. So can('dashboard')
    // evaluated `['dashboard'].includes('SUPER_ADMIN')` and returned false for
    // everyone -- including a super admin. The effect was that the entire admin
    // sidebar rendered empty: section headings with no links under them, on every
    // admin page, for every role. Delegate to the matrix instead of reimplementing
    // the check, so there is one definition of what a permission means.
    res.locals.can = (permission) => can(user.role, permission);

    return next();
  } catch (err) {
    return next(err);
  }
}

/** Require any authenticated session. */
function requireAuth(req, res, next) {
  if (req.user) return next();
  req.session.returnTo = req.originalUrl;
  req.flash('error', 'Please sign in to continue.');
  return res.redirect('/login');
}

/** Require an authenticated customer (used by /account/*). */
function requireCustomer(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    req.flash('error', 'Please sign in to continue.');
    return res.redirect('/login');
  }
  if (req.user.role !== 'CUSTOMER') {
    // Staff hitting a customer route is a navigation mistake, not an attack —
    // send them to the panel they actually belong in.
    return res.redirect('/admin');
  }
  return next();
}

/**
 * Require one of the given staff roles.
 * Usage: requireRole('SUPER_ADMIN', 'ADMIN')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/login');
    }
    if (req.user.role === 'CUSTOMER') {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    return next();
  };
}

/** Admin panel entry: any non-customer role. */
const requireStaff = requireRole();

/** Destructive / configuration operations. */
const requireAdmin = requireRole('SUPER_ADMIN', 'ADMIN');

/** User management + role assignment. Only the owner account may do this. */
const requireSuperAdmin = requireRole('SUPER_ADMIN');

/**
 * Permission matrix for the admin sidebar and command-level checks.
 * Kept as data so the nav and the guards can never drift apart.
 */
const PERMISSIONS = {
  dashboard: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'SUPPORT'],
  users: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  usersDelete: ['SUPER_ADMIN'],
  roles: ['SUPER_ADMIN'],
  services: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF'],
  packages: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  orders: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'SUPPORT'],
  ordersDelete: ['SUPER_ADMIN', 'ADMIN'],
  projects: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF'],
  subscriptions: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  invoices: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  payments: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  coupons: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  tickets: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'SUPPORT'],
  leads: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SUPPORT'],
  content: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  testimonials: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  portfolio: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  settings: ['SUPER_ADMIN', 'ADMIN'],
  activity: ['SUPER_ADMIN', 'ADMIN'],
  reports: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
};

function can(role, permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return allowed.includes(role);
}

/** Guard that reads the PERMISSIONS matrix. */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/login');
    }
    if (!can(req.user.role, permission)) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    return next();
  };
}

/** Redirect already-authenticated users away from login/register pages. */
function redirectIfAuthed(req, res, next) {
  if (!req.user) return next();
  return res.redirect(req.user.role === 'CUSTOMER' ? '/account' : '/admin');
}

module.exports = {
  loadUser, requireAuth, requireCustomer,
  requireRole, requireStaff, requireAdmin, requireSuperAdmin,
  requirePermission, redirectIfAuthed, can, PERMISSIONS,
};
