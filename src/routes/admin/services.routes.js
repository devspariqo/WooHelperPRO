'use strict';

const express = require('express');

const prisma = require('../../config/prisma');
const audit = require('../../services/audit.service');
const { fromLines, toLines, parse } = require('../../utils/json');
const { slugify } = require('../../utils/format');
const { requirePermission } = require('../../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------
// GET /admin/services
// ---------------------------------------------------------------
router.get('/', requirePermission('services'), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();

    const where = {};
    if (status) where.status = status;
    if (q) where.OR = [{ title: { contains: q } }, { shortDesc: { contains: q } }];

    const [services, categories] = await Promise.all([
      prisma.service.findMany({
        where,
        include: { category: true, _count: { select: { packages: true } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      prisma.serviceCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
    ]);

    res.render('admin/services/index', {
      title: 'Services',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'services',
      metaTitle: 'Services — WooHelperPro admin',
      services,
      categories,
      filters: { q, status },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/services/categories
// ---------------------------------------------------------------
router.get('/categories', requirePermission('services'), async (req, res, next) => {
  try {
    const categories = await prisma.serviceCategory.findMany({
      include: { _count: { select: { services: true } } },
      orderBy: { sortOrder: 'asc' },
    });

    res.render('admin/services/categories', {
      title: 'Service categories',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'services',
      metaTitle: 'Service categories — WooHelperPro admin',
      categories,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/categories', requirePermission('services'), async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (name.length < 2) {
      req.flash('error', 'Enter a category name.');
      return res.redirect('/admin/services/categories');
    }

    const baseSlug = slugify(req.body.slug || name);
    let slug = baseSlug;
    let suffix = 1;
    while (await prisma.serviceCategory.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const category = await prisma.serviceCategory.create({
      data: {
        name,
        nameBn: String(req.body.nameBn || name).trim(),
        slug,
        description: String(req.body.description || '').trim() || null,
        icon: String(req.body.icon || 'layout').trim(),
        sortOrder: Number(req.body.sortOrder) || 0,
        isActive: req.body.isActive !== 'off',
      },
    });

    await audit.log(req, 'service_category.created', {
      entityType: 'ServiceCategory',
      entityId: category.id,
      detail: name,
    });

    req.flash('success', `Category "${name}" created.`);
    return res.redirect('/admin/services/categories');
  } catch (err) {
    return next(err);
  }
});

router.post('/categories/:id', requirePermission('services'), async (req, res, next) => {
  try {
    const { name = '', nameBn = '', description = '', icon = 'layout', sortOrder = 0 } = req.body;

    await prisma.serviceCategory.update({
      where: { id: req.params.id },
      data: {
        name: String(name).trim(),
        nameBn: String(nameBn).trim() || String(name).trim(),
        description: String(description).trim() || null,
        icon: String(icon).trim(),
        sortOrder: Number(sortOrder) || 0,
        isActive: req.body.isActive === 'on',
      },
    });

    await audit.log(req, 'service_category.updated', { entityType: 'ServiceCategory', entityId: req.params.id });

    req.flash('success', 'Category updated.');
    return res.redirect('/admin/services/categories');
  } catch (err) {
    return next(err);
  }
});

router.post('/categories/:id/delete', requirePermission('services'), async (req, res, next) => {
  try {
    const inUse = await prisma.service.count({ where: { categoryId: req.params.id } });
    if (inUse > 0) {
      req.flash('error', `This category still has ${inUse} service(s). Move them first.`);
      return res.redirect('/admin/services/categories');
    }

    await prisma.serviceCategory.delete({ where: { id: req.params.id } });
    await audit.log(req, 'service_category.deleted', { entityType: 'ServiceCategory', entityId: req.params.id });

    req.flash('success', 'Category deleted.');
    return res.redirect('/admin/services/categories');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/services/new
// ---------------------------------------------------------------
router.get('/new', requirePermission('services'), async (req, res, next) => {
  try {
    const categories = await prisma.serviceCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    res.render('admin/services/form', {
      title: 'Add service',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'services',
      metaTitle: 'Add service — WooHelperPro admin',
      service: null,
      categories,
      featureLines: '',
      featureBnLines: '',
    });
  } catch (err) {
    return next(err);
  }
});

function readServiceForm(body, existing = null) {
  return {
    title: String(body.title || '').trim(),
    titleBn: String(body.titleBn || '').trim() || null,
    categoryId: body.categoryId || null,
    shortDesc: String(body.shortDesc || '').trim(),
    shortDescBn: String(body.shortDescBn || '').trim() || null,
    description: String(body.description || '').trim(),
    descriptionBn: String(body.descriptionBn || '').trim() || null,
    icon: String(body.icon || 'layout').trim(),
    imageUrl: String(body.imageUrl || '').trim() || null,
    basePrice: Number(body.basePrice) || 0,
    features: fromLines(body.features),
    featuresBn: fromLines(body.featuresBn),
    deliveryDays: Number(body.deliveryDays) || 7,
    status: ['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(body.status) ? body.status : 'ACTIVE',
    isFeatured: body.isFeatured === 'on',
    sortOrder: Number(body.sortOrder) || 0,
    metaTitle: String(body.metaTitle || '').trim() || null,
    metaDescription: String(body.metaDescription || '').trim() || null,
  };
}

router.post('/', requirePermission('services'), async (req, res, next) => {
  try {
    const data = readServiceForm(req.body);
    if (data.title.length < 3) {
      req.flash('error', 'Enter a service title.');
      return res.redirect('/admin/services/new');
    }

    const baseSlug = slugify(req.body.slug || data.title);
    let slug = baseSlug;
    let suffix = 1;
    while (await prisma.service.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const service = await prisma.service.create({ data: { ...data, slug } });

    await audit.log(req, 'service.created', {
      entityType: 'Service',
      entityId: service.id,
      detail: service.title,
    });

    req.flash('success', `Service "${service.title}" created. Now add a package to make it orderable.`);
    return res.redirect(`/admin/services/${service.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/services/:id
// ---------------------------------------------------------------
router.get('/:id', requirePermission('services'), async (req, res, next) => {
  try {
    const service = await prisma.service.findUnique({
      where: { id: req.params.id },
      include: {
        category: true,
        packages: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { packages: true } },
      },
    });

    if (!service) return res.status(404).render('errors/404', { title: 'Service not found' });

    res.render('admin/services/detail', {
      title: service.title,
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'services',
      metaTitle: `${service.title} — WooHelperPro admin`,
      service,
      features: parse(service.features),
      featuresBn: parse(service.featuresBn),
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/services/:id/edit
// ---------------------------------------------------------------
router.get('/:id/edit', requirePermission('services'), async (req, res, next) => {
  try {
    const [service, categories] = await Promise.all([
      prisma.service.findUnique({ where: { id: req.params.id } }),
      prisma.serviceCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
    ]);

    if (!service) return res.status(404).render('errors/404', { title: 'Service not found' });

    res.render('admin/services/form', {
      title: `Edit ${service.title}`,
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'services',
      metaTitle: `Edit ${service.title} — WooHelperPro admin`,
      service,
      categories,
      featureLines: toLines(service.features),
      featureBnLines: toLines(service.featuresBn),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id', requirePermission('services'), async (req, res, next) => {
  try {
    const existing = await prisma.service.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).render('errors/404', { title: 'Service not found' });

    const data = readServiceForm(req.body, existing);

    // Only re-slug when the title actually changed and the admin asked for it.
    if (req.body.regenerateSlug === 'on' && data.title !== existing.title) {
      let slug = slugify(data.title);
      let suffix = 1;
      while (await prisma.service.findFirst({ where: { slug, id: { not: existing.id } } })) {
        slug = `${slugify(data.title)}-${suffix++}`;
      }
      data.slug = slug;
    }

    await prisma.service.update({ where: { id: existing.id }, data });

    await audit.log(req, 'service.updated', { entityType: 'Service', entityId: existing.id, detail: data.title });

    req.flash('success', 'Service updated.');
    return res.redirect(`/admin/services/${existing.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// POST /admin/services/:id/delete
// ---------------------------------------------------------------
router.post('/:id/delete', requirePermission('services'), async (req, res, next) => {
  try {
    const orderCount = await prisma.order.count({ where: { serviceId: req.params.id } });

    // Historical orders reference the service; archive instead of breaking them.
    if (orderCount > 0) {
      await prisma.service.update({ where: { id: req.params.id }, data: { status: 'ARCHIVED' } });
      await audit.log(req, 'service.archived', {
        entityType: 'Service',
        entityId: req.params.id,
        detail: `Archived: referenced by ${orderCount} order(s)`,
      });
      req.flash('warning', 'This service has orders attached, so it was archived rather than deleted.');
      return res.redirect('/admin/services');
    }

    await prisma.package.deleteMany({ where: { serviceId: req.params.id } });
    await prisma.service.delete({ where: { id: req.params.id } });

    await audit.log(req, 'service.deleted', { entityType: 'Service', entityId: req.params.id });

    req.flash('success', 'Service deleted.');
    return res.redirect('/admin/services');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
