'use strict';

const express = require('express');
const path = require('path');
const ejs = require('ejs');

const prisma = require('../config/prisma');
const pricing = require('../services/pricing.service');
const orderService = require('../services/order.service');
const invoiceService = require('../services/invoice.service');
const audit = require('../services/audit.service');
const mailer = require('../services/mailer.service');
const sec = require('../utils/security');
const ids = require('../utils/ids');
const { parse } = require('../utils/json');
const { formLimiter } = require('../middleware/rateLimit');
const { requireAuth } = require('../middleware/auth');
const { DISTRICTS, BUSINESS_TYPES, TICKET_CATEGORIES } = require('../config/constants');

const router = express.Router();

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// ---------------------------------------------------------------
// GET / — homepage
// ---------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const [services, packages, categories, testimonials, portfolio, posts, faqs, stats, leads] =
      await Promise.all([
        prisma.service.findMany({
          where: { status: 'ACTIVE' },
          include: { category: true },
          orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }],
          take: 9,
        }),
        prisma.package.findMany({
          where: { isActive: true },
          orderBy: [{ isPopular: 'desc' }, { sortOrder: 'asc' }],
          take: 6,
        }),
        prisma.serviceCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
        prisma.testimonial.findMany({ where: { isApproved: true }, orderBy: { createdAt: 'desc' }, take: 6 }),
        prisma.portfolioItem.findMany({
          where: { isPublished: true },
          orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }],
          take: 6,
        }),
        prisma.blogPost.findMany({
          where: { status: 'PUBLISHED' },
          orderBy: { publishedAt: 'desc' },
          take: 3,
        }),
        prisma.faq.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, take: 8 }),
        Promise.all([
          prisma.order.count({ where: { status: { notIn: ['CANCELLED'] } } }),
          prisma.user.count({ where: { role: 'CUSTOMER' } }),
          prisma.order.aggregate({
            where: { status: { in: ['COMPLETED', 'DELIVERED'] } },
            _sum: { total: true },
          }),
          prisma.portfolioItem.count({ where: { isPublished: true } }),
        ]),
        prisma.lead.count(),
      ]);

    const [orderCount, customerCount, revenue, portfolioCount] = stats;

    res.render('public/home', {
      title: 'E-commerce website design & management in Bangladesh',
      layout: 'layouts/public',
      bodyClass: 'page-home',
      metaTitle: 'WooHelperPro — E-commerce website design & management in Bangladesh',
      metaDescription:
        'We design, build and manage high-converting e-commerce websites for Bangladeshi businesses. Order a package, pay with bKash, Nagad or Rocket, go live in 7 days.',
      services,
      packages,
      categories,
      testimonials,
      portfolio,
      posts,
      faqs,
      stats: {
        orders: orderCount,
        customers: customerCount,
        portfolio: portfolioCount,
        revenue: revenue._sum.total || 0,
        leads,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /services — catalogue
// ---------------------------------------------------------------
router.get('/services', async (req, res, next) => {
  try {
    const { category, q } = req.query;

    const where = { status: 'ACTIVE' };
    if (category) {
      const cat = await prisma.serviceCategory.findUnique({ where: { slug: String(category) } });
      if (cat) where.categoryId = cat.id;
    }
    if (q) {
      where.OR = [
        { title: { contains: String(q) } },
        { shortDesc: { contains: String(q) } },
        { description: { contains: String(q) } },
      ];
    }

    const [services, categories] = await Promise.all([
      prisma.service.findMany({
        where,
        include: { category: true, packages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
        orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }],
      }),
      prisma.serviceCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    ]);

    res.render('public/services', {
      title: 'Our services',
      layout: 'layouts/public',
      bodyClass: 'page-services',
      metaTitle: 'Services — WooHelperPro e-commerce website design Bangladesh',
      metaDescription:
        'E-commerce website build, landing pages, payment gateway and courier integration, SEO, ads management and ongoing maintenance for Bangladeshi online businesses.',
      services,
      categories,
      activeCategory: category || '',
      searchQuery: q || '',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /services/:slug
// ---------------------------------------------------------------
router.get('/services/:slug', async (req, res, next) => {
  try {
    const service = await prisma.service.findFirst({
      where: { slug: req.params.slug, status: 'ACTIVE' },
      include: {
        category: true,
        packages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!service) {
      return res.status(404).render('errors/404', { title: 'Service not found' });
    }

    const related = await prisma.service.findMany({
      where: { status: 'ACTIVE', id: { not: service.id } },
      orderBy: { sortOrder: 'asc' },
      take: 3,
    });

    res.render('public/service-detail', {
      title: service.title,
      layout: 'layouts/public',
      bodyClass: 'page-service-detail',
      metaTitle: service.metaTitle || `${service.title} — WooHelperPro`,
      metaDescription: service.metaDescription || service.shortDesc,
      service,
      features: parse(service.features),
      featuresBn: parse(service.featuresBn),
      related,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /packages — pricing
// ---------------------------------------------------------------
router.get('/packages', async (req, res, next) => {
  try {
    const [packages, services] = await Promise.all([
      prisma.package.findMany({
        where: { isActive: true },
        include: { service: true },
        orderBy: [{ isPopular: 'desc' }, { price: 'asc' }],
      }),
      prisma.service.findMany({ where: { status: 'ACTIVE' }, select: { id: true, title: true } }),
    ]);

    res.render('public/packages', {
      title: 'Packages & pricing',
      layout: 'layouts/public',
      bodyClass: 'page-packages',
      metaTitle: 'Packages & pricing — WooHelperPro',
      metaDescription:
        'Transparent one-time and monthly website design packages for Bangladeshi e-commerce businesses. Compare features and order online with bKash, Nagad or Rocket.',
      packages,
      services,
      billing: req.query.billing === 'monthly' ? 'monthly' : 'one_time',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /packages/:slug
// ---------------------------------------------------------------
router.get('/packages/:slug', async (req, res, next) => {
  try {
    const pkg = await prisma.package.findFirst({
      where: { slug: req.params.slug, isActive: true },
      include: { service: true },
    });
    if (!pkg) return res.status(404).render('errors/404', { title: 'Package not found' });

    const [features, excluded] = [parse(pkg.features), parse(pkg.excluded)];

    res.render('public/package-detail', {
      title: pkg.name,
      layout: 'layouts/public',
      bodyClass: 'page-package-detail',
      metaTitle: `${pkg.name} package — WooHelperPro`,
      metaDescription: pkg.tagline || `Order the ${pkg.name} website package from WooHelperPro.`,
      package: pkg,
      features,
      excluded,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /order/checkout — the order form ("we build a website for you")
// ---------------------------------------------------------------
router.get('/order/checkout', async (req, res, next) => {
  try {
    const selectedPackage = req.query.package
      ? await prisma.package.findFirst({
          where: { id: String(req.query.package), isActive: true },
          include: { service: true },
        })
      : null;

    const packages = await prisma.package.findMany({
      where: { isActive: true },
      orderBy: [{ isPopular: 'desc' }, { price: 'asc' }],
    });

    // NOTE: the checkout view used to render an "Additional service" select
    // guarded by `typeof services !== 'undefined'`, but no route ever passed
    // `services`, so that block could never render. It was also misleading:
    // the order's service is derived from the chosen package
    // (`serviceId: pkg.serviceId` in POST /order/checkout), and
    // `req.body.serviceId` is never read. A customer therefore cannot pick a
    // service independently of the package, so the dead field was removed
    // rather than wired up.

    res.render('public/checkout', {
      title: 'Order your website',
      layout: 'layouts/public',
      bodyClass: 'page-checkout',
      metaTitle: 'Order your e-commerce website — WooHelperPro',
      metaDescription: 'Tell us about your business and we will build your website. Pay online with bKash, Nagad or Rocket.',
      packages,
      selectedPackage,
      districts: DISTRICTS,
      businessTypes: BUSINESS_TYPES,
      quote: null,
      values: {},
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /order/quote — recalculate the basket without losing the form
// ---------------------------------------------------------------
router.post('/order/quote', formLimiter, async (req, res, next) => {
  try {
    const packageId = String(req.body.packageId || '');
    const couponCode = String(req.body.couponCode || '').trim().toUpperCase();
    const paymentMode = ['one_time', 'monthly', 'yearly'].includes(req.body.paymentMode)
      ? req.body.paymentMode
      : 'one_time';

    if (!packageId) {
      return res.status(400).json({ ok: false, error: 'Select a package first.' });
    }

    const quote = await pricing.quotePackage({ packageId, couponCode, paymentMode });

    return res.json({
      ok: true,
      // Re-render the totals block server-side so the numbers match the invoice exactly.
      //
      // Rendered with ejs directly rather than res.render: express-ejs-layouts
      // wraps every res.render in the default layout, and a `layout: false`
      // local does not reliably suppress that for a partial path — the layout
      // then fails on locals only the full page sets. Compiling the partial on
      // its own is both simpler and exactly what this endpoint means.
      html: await ejs.renderFile(
        path.join(req.app.get('views'), 'partials', 'order-summary.ejs'),
        { quote, ...res.locals },
        { async: true },
      ),
      totals: {
        subtotal: quote.subtotal,
        discount: quote.discount,
        tax: quote.tax,
        total: quote.total,
      },
      couponMessage: quote.couponMessage,
      couponValid: Boolean(quote.coupon),
    });
  } catch (err) {
    if (err.status === 404 || err.status === 400) {
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /order/checkout — place the order
// ---------------------------------------------------------------
router.post('/order/checkout', formLimiter, async (req, res, next) => {
  const renderError = (error, extra = {}) =>
    res.status(400).render('public/checkout', {
      title: 'Order your website',
      layout: 'layouts/public',
      bodyClass: 'page-checkout',
      metaTitle: 'Order your e-commerce website — WooHelperPro',
      error,
      ...extra,
    });

  try {
    const b = req.body;

    const packages = await prisma.package.findMany({
      where: { isActive: true },
      orderBy: [{ isPopular: 'desc' }, { price: 'asc' }],
    });

    const packageId = String(b.packageId || '');
    const pkg = packageId ? await prisma.package.findFirst({ where: { id: packageId, isActive: true } }) : null;

    if (!pkg) {
      return renderError('Please choose a package to continue.', {
        packages, selectedPackage: null, districts: DISTRICTS, businessTypes: BUSINESS_TYPES,
        values: b,
      });
    }

    const projectName = String(b.projectName || '').trim();
    const contactName = String(b.contactName || '').trim();
    const contactPhone = sec.normalizeBdPhone(b.contactPhone);
    const contactEmail = String(b.contactEmail || '').trim().toLowerCase();

    const errors = [];
    if (projectName.length < 2) errors.push('Enter a project or business name.');
    if (contactName.length < 2) errors.push('Enter a contact person name.');
    if (!contactPhone) errors.push('Enter a valid Bangladeshi mobile number.');
    if (contactEmail && !sec.isValidEmail(contactEmail)) errors.push('Enter a valid email address.');
    if (!String(b.district || '').trim()) errors.push('Select your district.');

    if (errors.length) {
      return renderError(errors.join(' '), {
        packages, selectedPackage: pkg, districts: DISTRICTS, businessTypes: BUSINESS_TYPES,
        values: b,
      });
    }

    const paymentMode = ['one_time', 'monthly', 'yearly'].includes(b.paymentMode) ? b.paymentMode : 'one_time';
    const couponCode = String(b.couponCode || '').trim().toUpperCase();

    const quote = await pricing.quotePackage({ packageId: pkg.id, couponCode, paymentMode });

    // Guest checkout is allowed; a lightweight account is created so the
    // customer can track the order. Explicit password is set later via reset.
    let user = req.user;
    if (!user) {
      const email = contactEmail || `${contactPhone.replace(/\D/g, '')}@guest.woohelperpro.local`;
      user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        const tempPassword = `whp${ids.token(8)}`;
        user = await prisma.user.create({
          data: {
            name: contactName,
            email,
            phone: contactPhone,
            passwordHash: await sec.hash(tempPassword),
            role: 'CUSTOMER',
            status: 'ACTIVE',
            district: String(b.district || '').trim() || null,
            address: String(b.billingAddress || '').trim() || null,
            company: String(b.businessName || '').trim() || null,
          },
        });
        await audit.log(req, 'user.created_guest', {
          entityType: 'User', entityId: user.id, userId: null,
          detail: `Guest account created for order by ${contactName}`,
        });
      }
    }

    const selectedPages = Array.isArray(b.selectedPages)
      ? b.selectedPages
      : String(b.selectedPages || '').split(',').map((s) => s.trim()).filter(Boolean);

    const order = await orderService.createOrder({
      userId: user.id,
      packageId: pkg.id,
      serviceId: pkg.serviceId,
      projectName,
      projectType: pkg.service ? pkg.service.title : 'E-commerce Website',
      businessName: String(b.businessName || '').trim() || null,
      businessType: String(b.businessType || '').trim() || null,
      websiteGoal: String(b.websiteGoal || '').trim() || null,
      referenceUrls: String(b.referenceUrls || '').trim() || null,
      selectedPages,
      domainName: String(b.domainName || '').trim() || null,
      hostingChoice: String(b.hostingChoice || '').trim() || null,
      preferredColors: String(b.preferredColors || '').trim() || null,
      brandNotes: String(b.brandNotes || '').trim() || null,
      contactPerson: contactName,
      contactPhone,
      contactEmail: contactEmail || null,
      district: String(b.district || '').trim() || null,
      billingAddress: String(b.billingAddress || '').trim() || null,
      subtotal: quote.subtotal,
      discount: quote.discount,
      tax: quote.tax,
      total: quote.total,
      couponCode: quote.coupon ? couponCode : null,
      priority: String(b.priority || 'NORMAL'),
      clientNotes: String(b.notes || '').trim() || null,
      dueDate: new Date(Date.now() + (pkg.deliveryDays || 7) * 86400000),
    });

    // Raise the invoice immediately so the payment page has something to pay.
    const invoice = await invoiceService.createInvoiceForOrder(order);

    await audit.log(req, 'order.created', {
      entityType: 'Order',
      entityId: order.id,
      userId: user.id,
      detail: `${order.orderNumber} — ${projectName} (৳${quote.total})`,
    });

    mailer.notify('orderPlaced', [order], { to: user.email }).catch(() => {});
    if (invoice) mailer.notify('invoice', [invoice], { to: user.email }).catch(() => {});
    // Tell the team as well, so an order is not missed until someone opens the panel.
    mailer.notify('adminNewOrder', [order], { kind: 'admin' }).catch(() => {});

    // A guest has no session yet — sign them in so they can complete payment.
    if (!req.user) {
      req.session.userId = user.id;
      req.session.role = user.role;
      await new Promise((resolve) => req.session.save(resolve));
    }

    req.flash('success', `Order ${order.orderNumber} received. Complete the payment to start production.`);
    return res.redirect(`/account/orders/${order.id}`);
  } catch (err) {
    if (err.status && err.status < 500) {
      return renderError(err.message, {
        packages: [], selectedPackage: null, districts: DISTRICTS, businessTypes: BUSINESS_TYPES,
        values: req.body,
      });
    }
    return next(err);
  }
});

// ---------------------------------------------------------------
// Static-ish marketing pages
// ---------------------------------------------------------------
router.get('/portfolio', async (req, res, next) => {
  try {
    const items = await prisma.portfolioItem.findMany({
      where: { isPublished: true },
      orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }],
    });
    res.render('public/portfolio', {
      title: 'Our work',
      layout: 'layouts/public',
      bodyClass: 'page-portfolio',
      metaTitle: 'Portfolio — WooHelperPro website projects in Bangladesh',
      metaDescription: 'E-commerce websites we designed and launched for Bangladeshi brands.',
      items,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/about', async (req, res) => {
  const [customers, orders, portfolioCount] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.order.count(),
    prisma.portfolioItem.count({ where: { isPublished: true } }),
  ]);
  res.render('public/about', {
    title: 'About us',
    layout: 'layouts/public',
    bodyClass: 'page-about',
    metaTitle: 'About WooHelperPro — Bangladesh e-commerce website agency',
    metaDescription:
      'WooHelperPro is a Bangladeshi web design agency building and managing e-commerce websites for local online businesses.',
    stats: { customers, orders, portfolio: portfolioCount },
  });
});

router.get('/pricing', (req, res) => res.redirect(301, '/packages'));

// ---------------------------------------------------------------
// Blog
// ---------------------------------------------------------------
router.get('/blog', async (req, res, next) => {
  try {
    const posts = await prisma.blogPost.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
    });
    res.render('public/blog', {
      title: 'Blog',
      layout: 'layouts/public',
      bodyClass: 'page-blog',
      metaTitle: 'Blog — e-commerce tips for Bangladeshi businesses | WooHelperPro',
      metaDescription: 'Guides on selling online in Bangladesh: payments, couriers, ads and conversion.',
      posts,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/blog/:slug', async (req, res, next) => {
  try {
    const post = await prisma.blogPost.findFirst({
      where: { slug: req.params.slug, status: 'PUBLISHED' },
    });
    if (!post) return res.status(404).render('errors/404', { title: 'Post not found' });

    await prisma.blogPost.update({ where: { id: post.id }, data: { views: { increment: 1 } } });

    const related = await prisma.blogPost.findMany({
      where: { status: 'PUBLISHED', id: { not: post.id } },
      orderBy: { publishedAt: 'desc' },
      take: 3,
    });

    res.render('public/blog-detail', {
      title: post.title,
      layout: 'layouts/public',
      bodyClass: 'page-blog-detail',
      metaTitle: post.metaTitle || `${post.title} — WooHelperPro`,
      metaDescription: post.metaDescription || post.excerpt,
      post,
      related,
      tags: parse(post.tags),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Contact + lead capture
// ---------------------------------------------------------------
router.get('/contact', async (req, res) => {
  const faqs = await prisma.faq.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  res.render('public/contact', {
    title: 'Contact us',
    layout: 'layouts/public',
    bodyClass: 'page-contact',
    metaTitle: 'Contact WooHelperPro — talk to our team',
    metaDescription: 'Call, WhatsApp or email WooHelperPro for a free consultation on your e-commerce website.',
    districts: DISTRICTS,
    faqs,
  });
});

router.post('/contact', formLimiter, async (req, res, next) => {
  try {
    const { name = '', phone = '', email = '', company = '', district = '', serviceType = '', budget = '', message = '' } = req.body;

    const cleanName = String(name).trim();
    const normalizedPhone = sec.normalizeBdPhone(phone);

    if (cleanName.length < 2 || !normalizedPhone) {
      req.flash('error', 'Please provide your name and a valid Bangladeshi mobile number.');
      return res.redirect('/contact');
    }

    const lead = await prisma.lead.create({
      data: {
        name: cleanName,
        phone: normalizedPhone,
        email: String(email).trim().toLowerCase() || null,
        company: String(company).trim() || null,
        district: String(district).trim() || null,
        serviceType: String(serviceType).trim() || null,
        budget: String(budget).trim() || null,
        message: String(message).trim() || null,
        source: 'WEBSITE_CONTACT',
        status: 'NEW',
      },
    });

    await audit.log(req, 'lead.created', {
      entityType: 'Lead',
      entityId: lead.id,
      userId: req.user?.id ?? null,
      detail: `${cleanName} (${normalizedPhone}) — ${serviceType || 'general enquiry'}`,
    });

    // Enquiries are time-sensitive: the promise on screen is a call within one
    // business day, so the team is told immediately rather than on next login.
    mailer.notify('adminNewLead', [lead], { kind: 'admin' }).catch(() => {});

    req.flash('success', 'Thank you. Our team will call you within one business day.');
    return res.redirect('/contact');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// Free consultation request from a package page
// ---------------------------------------------------------------
router.post('/request-callback', formLimiter, async (req, res) => {
  const phone = sec.normalizeBdPhone(req.body.phone);
  if (!phone) {
    req.flash('error', 'Enter a valid mobile number so we can call you.');
    return res.redirect(req.get('referer') || '/');
  }

  await prisma.lead.create({
    data: {
      name: String(req.body.name || 'Callback request').trim(),
      phone,
      email: String(req.body.email || '').trim().toLowerCase() || null,
      serviceType: String(req.body.interest || '').trim() || null,
      message: String(req.body.message || '').trim() || null,
      source: 'CALLBACK_REQUEST',
      status: 'NEW',
    },
  });

  req.flash('success', 'We received your number. Expect a call shortly.');
  return res.redirect(req.get('referer') || '/');
});

// ---------------------------------------------------------------
// Legal pages
// ---------------------------------------------------------------
const LEGAL = {
  'terms': 'Terms & Conditions',
  'privacy': 'Privacy Policy',
  'refund': 'Refund Policy',
};

router.get('/legal/:page', (req, res) => {
  const key = String(req.params.page).toLowerCase();
  const title = LEGAL[key];
  if (!title) return res.status(404).render('errors/404', { title: 'Page not found' });
  return res.render(`public/legal/${key}`, {
    title,
    layout: 'layouts/public',
    bodyClass: 'page-legal',
    metaTitle: `${title} — WooHelperPro`,
  });
});

module.exports = router;
