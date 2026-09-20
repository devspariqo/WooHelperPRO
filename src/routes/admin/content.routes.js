'use strict';

const express = require('express');

const prisma = require('../../config/prisma');
const audit = require('../../services/audit.service');
const { slugify } = require('../../utils/format');
const { fromLines, toLines, parse } = require('../../utils/json');
const { requirePermission } = require('../../middleware/auth');
const { DISTRICTS } = require('../../config/constants');

const router = express.Router();

// ===============================================================
// TESTIMONIALS  (moderation queue)
// ===============================================================

router.get('/testimonials', requirePermission('testimonials'), async (req, res, next) => {
  try {
    const testimonials = await prisma.testimonial.findMany({ orderBy: { createdAt: 'desc' } });
    res.render('admin/content/testimonials', {
      title: 'Testimonials',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'testimonials',
      metaTitle: 'Testimonials — WooHelperPro admin',
      testimonials,
      districts: DISTRICTS,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/testimonials', requirePermission('testimonials'), async (req, res, next) => {
  try {
    const clientName = String(req.body.clientName || '').trim();
    const body = String(req.body.body || '').trim();

    if (clientName.length < 2 || body.length < 10) {
      req.flash('error', 'A testimonial needs a client name and at least a sentence of content.');
      return res.redirect('/admin/testimonials');
    }

    await prisma.testimonial.create({
      data: {
        clientName,
        company: String(req.body.company || '').trim() || null,
        district: String(req.body.district || '').trim() || null,
        rating: Math.min(5, Math.max(1, Number(req.body.rating) || 5)),
        body,
        bodyBn: String(req.body.bodyBn || '').trim() || null,
        isApproved: req.body.isApproved === 'on',
        isFeatured: req.body.isFeatured === 'on',
      },
    });

    await audit.log(req, 'testimonial.created', { detail: clientName });

    req.flash('success', 'Testimonial added.');
    return res.redirect('/admin/testimonials');
  } catch (err) {
    return next(err);
  }
});

router.post('/testimonials/:id', requirePermission('testimonials'), async (req, res, next) => {
  try {
    await prisma.testimonial.update({
      where: { id: req.params.id },
      data: {
        isApproved: req.body.isApproved === 'on',
        isFeatured: req.body.isFeatured === 'on',
        rating: Math.min(5, Math.max(1, Number(req.body.rating) || 5)),
        body: String(req.body.body || '').trim(),
        bodyBn: String(req.body.bodyBn || '').trim() || null,
      },
    });

    await audit.log(req, 'testimonial.updated', { entityType: 'Testimonial', entityId: req.params.id });

    req.flash('success', 'Testimonial updated.');
    return res.redirect('/admin/testimonials');
  } catch (err) {
    return next(err);
  }
});

router.post('/testimonials/:id/delete', requirePermission('testimonials'), async (req, res, next) => {
  try {
    await prisma.testimonial.delete({ where: { id: req.params.id } });
    req.flash('success', 'Testimonial deleted.');
    return res.redirect('/admin/testimonials');
  } catch (err) {
    return next(err);
  }
});

// ===============================================================
// PORTFOLIO
// ===============================================================

router.get('/portfolio', requirePermission('portfolio'), async (req, res, next) => {
  try {
    const items = await prisma.portfolioItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
    res.render('admin/content/portfolio', {
      title: 'Portfolio',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'portfolio',
      metaTitle: 'Portfolio — WooHelperPro admin',
      items,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/portfolio', requirePermission('portfolio'), async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    if (title.length < 2) {
      req.flash('error', 'Enter a project title.');
      return res.redirect('/admin/portfolio');
    }

    let slug = slugify(req.body.slug || title);
    let suffix = 1;
    while (await prisma.portfolioItem.findUnique({ where: { slug } })) {
      slug = `${slugify(title)}-${suffix++}`;
    }

    await prisma.portfolioItem.create({
      data: {
        title,
        titleBn: String(req.body.titleBn || '').trim() || null,
        slug,
        clientName: String(req.body.clientName || '').trim() || null,
        category: String(req.body.category || '').trim() || null,
        description: String(req.body.description || '').trim() || null,
        imageUrl: String(req.body.imageUrl || '').trim() || null,
        liveUrl: String(req.body.liveUrl || '').trim() || null,
        results: String(req.body.results || '').trim() || null,
        techStack: String(req.body.techStack || '').trim() || null,
        isPublished: req.body.isPublished !== 'off',
        isFeatured: req.body.isFeatured === 'on',
        sortOrder: Number(req.body.sortOrder) || 0,
      },
    });

    await audit.log(req, 'portfolio.created', { detail: title });

    req.flash('success', 'Portfolio item added.');
    return res.redirect('/admin/portfolio');
  } catch (err) {
    return next(err);
  }
});

router.post('/portfolio/:id', requirePermission('portfolio'), async (req, res, next) => {
  try {
    await prisma.portfolioItem.update({
      where: { id: req.params.id },
      data: {
        title: String(req.body.title || '').trim(),
        titleBn: String(req.body.titleBn || '').trim() || null,
        clientName: String(req.body.clientName || '').trim() || null,
        category: String(req.body.category || '').trim() || null,
        description: String(req.body.description || '').trim() || null,
        imageUrl: String(req.body.imageUrl || '').trim() || null,
        liveUrl: String(req.body.liveUrl || '').trim() || null,
        results: String(req.body.results || '').trim() || null,
        techStack: String(req.body.techStack || '').trim() || null,
        isPublished: req.body.isPublished === 'on',
        isFeatured: req.body.isFeatured === 'on',
        sortOrder: Number(req.body.sortOrder) || 0,
      },
    });

    req.flash('success', 'Portfolio item updated.');
    return res.redirect('/admin/portfolio');
  } catch (err) {
    return next(err);
  }
});

router.post('/portfolio/:id/delete', requirePermission('portfolio'), async (req, res, next) => {
  try {
    await prisma.portfolioItem.delete({ where: { id: req.params.id } });
    req.flash('success', 'Portfolio item deleted.');
    return res.redirect('/admin/portfolio');
  } catch (err) {
    return next(err);
  }
});

// ===============================================================
// BLOG
// ===============================================================

router.get('/blog', requirePermission('content'), async (req, res, next) => {
  try {
    const posts = await prisma.blogPost.findMany({ orderBy: { createdAt: 'desc' } });
    res.render('admin/content/blog', {
      title: 'Blog posts',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'blog',
      metaTitle: 'Blog — WooHelperPro admin',
      posts,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/blog/new', requirePermission('content'), (req, res) => {
  res.render('admin/content/blog-form', {
    title: 'New post',
    layout: 'layouts/dashboard',
    bodyClass: 'admin-page',
    panel: 'admin',
    active: 'blog',
    metaTitle: 'New post — WooHelperPro admin',
    post: null,
    tagLines: '',
  });
});

router.post('/blog', requirePermission('content'), async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();

    if (title.length < 4 || content.length < 20) {
      req.flash('error', 'A post needs a title and at least a paragraph of content.');
      return res.redirect('/admin/blog/new');
    }

    let slug = slugify(req.body.slug || title);
    let suffix = 1;
    while (await prisma.blogPost.findUnique({ where: { slug } })) {
      slug = `${slugify(title)}-${suffix++}`;
    }

    const status = req.body.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';

    const post = await prisma.blogPost.create({
      data: {
        title,
        titleBn: String(req.body.titleBn || '').trim() || null,
        slug,
        excerpt: String(req.body.excerpt || content.slice(0, 180)).trim(),
        content,
        coverImage: String(req.body.coverImage || '').trim() || null,
        category: String(req.body.category || 'Guides').trim() || null,
        tags: fromLines(req.body.tags),
        authorId: req.user.id,
        status,
        isFeatured: req.body.isFeatured === 'on',
        metaTitle: String(req.body.metaTitle || '').trim() || null,
        metaDescription: String(req.body.metaDescription || '').trim() || null,
        publishedAt: status === 'PUBLISHED' ? new Date() : null,
      },
    });

    await audit.log(req, 'blog.created', { entityType: 'BlogPost', entityId: post.id, detail: title });

    req.flash('success', `Post "${title}" ${status === 'PUBLISHED' ? 'published' : 'saved as a draft'}.`);
    return res.redirect('/admin/blog');
  } catch (err) {
    return next(err);
  }
});

router.get('/blog/:id/edit', requirePermission('content'), async (req, res, next) => {
  try {
    const post = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).render('errors/404', { title: 'Post not found' });

    res.render('admin/content/blog-form', {
      title: `Edit ${post.title}`,
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'blog',
      metaTitle: `Edit ${post.title} — WooHelperPro admin`,
      post,
      tagLines: toLines(post.tags),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/blog/:id', requirePermission('content'), async (req, res, next) => {
  try {
    const existing = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).render('errors/404', { title: 'Post not found' });

    const status = req.body.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';

    await prisma.blogPost.update({
      where: { id: existing.id },
      data: {
        title: String(req.body.title || '').trim(),
        titleBn: String(req.body.titleBn || '').trim() || null,
        excerpt: String(req.body.excerpt || '').trim() || null,
        content: String(req.body.content || '').trim(),
        coverImage: String(req.body.coverImage || '').trim() || null,
        category: String(req.body.category || '').trim() || null,
        tags: fromLines(req.body.tags),
        status,
        isFeatured: req.body.isFeatured === 'on',
        metaTitle: String(req.body.metaTitle || '').trim() || null,
        metaDescription: String(req.body.metaDescription || '').trim() || null,
        // Set publishedAt the first time it goes live; keep the original date after.
        publishedAt: status === 'PUBLISHED' ? existing.publishedAt || new Date() : null,
      },
    });

    await audit.log(req, 'blog.updated', { entityType: 'BlogPost', entityId: existing.id });

    req.flash('success', 'Post updated.');
    return res.redirect('/admin/blog');
  } catch (err) {
    return next(err);
  }
});

router.post('/blog/:id/delete', requirePermission('content'), async (req, res, next) => {
  try {
    await prisma.blogPost.delete({ where: { id: req.params.id } });
    await audit.log(req, 'blog.deleted', { entityType: 'BlogPost', entityId: req.params.id });
    req.flash('success', 'Post deleted.');
    return res.redirect('/admin/blog');
  } catch (err) {
    return next(err);
  }
});

// ===============================================================
// FAQ
// ===============================================================

router.get('/faqs', requirePermission('content'), async (req, res, next) => {
  try {
    const faqs = await prisma.faq.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
    res.render('admin/content/faqs', {
      title: 'FAQs',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'faqs',
      metaTitle: 'FAQs — WooHelperPro admin',
      faqs,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/faqs', requirePermission('content'), async (req, res, next) => {
  try {
    const question = String(req.body.question || '').trim();
    const answer = String(req.body.answer || '').trim();

    if (question.length < 5 || answer.length < 5) {
      req.flash('error', 'A FAQ needs both a question and an answer.');
      return res.redirect('/admin/faqs');
    }

    await prisma.faq.create({
      data: {
        question,
        questionBn: String(req.body.questionBn || '').trim() || null,
        answer,
        answerBn: String(req.body.answerBn || '').trim() || null,
        category: String(req.body.category || 'GENERAL').trim(),
        sortOrder: Number(req.body.sortOrder) || 0,
        isActive: req.body.isActive !== 'off',
      },
    });

    req.flash('success', 'FAQ added.');
    return res.redirect('/admin/faqs');
  } catch (err) {
    return next(err);
  }
});

router.post('/faqs/:id', requirePermission('content'), async (req, res, next) => {
  try {
    await prisma.faq.update({
      where: { id: req.params.id },
      data: {
        question: String(req.body.question || '').trim(),
        questionBn: String(req.body.questionBn || '').trim() || null,
        answer: String(req.body.answer || '').trim(),
        answerBn: String(req.body.answerBn || '').trim() || null,
        sortOrder: Number(req.body.sortOrder) || 0,
        isActive: req.body.isActive === 'on',
      },
    });

    req.flash('success', 'FAQ updated.');
    return res.redirect('/admin/faqs');
  } catch (err) {
    return next(err);
  }
});

router.post('/faqs/:id/delete', requirePermission('content'), async (req, res, next) => {
  try {
    await prisma.faq.delete({ where: { id: req.params.id } });
    req.flash('success', 'FAQ deleted.');
    return res.redirect('/admin/faqs');
  } catch (err) {
    return next(err);
  }
});

// ===============================================================
// SITE SETTINGS
// ===============================================================

router.get('/settings', requirePermission('settings'), async (req, res, next) => {
  try {
    let settings = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });
    if (!settings) settings = await prisma.siteSetting.create({ data: { id: 'singleton' } });

    res.render('admin/settings', {
      title: 'Site settings',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'settings',
      metaTitle: 'Site settings — WooHelperPro admin',
      site: settings,
      paymentConfig: require('../../config').payments,
      mailConfig: require('../../config').mail,
      courierConfig: require('../../config').couriers,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/settings', requirePermission('settings'), async (req, res, next) => {
  try {
    const str = (key, fallback = '') => String(req.body[key] ?? fallback).trim();

    await prisma.siteSetting.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {
        siteName: str('siteName') || 'WooHelperPro',
        tagline: str('tagline'),
        taglineBn: str('taglineBn'),
        supportEmail: str('supportEmail'),
        supportPhone: str('supportPhone'),
        whatsappNumber: str('whatsappNumber').replace(/[^\d]/g, ''),
        officeAddress: str('officeAddress'),
        bkashNumber: str('bkashNumber'),
        nagadNumber: str('nagadNumber'),
        rocketNumber: str('rocketNumber'),
        bankDetails: str('bankDetails'),
        vatPercent: Math.max(0, Math.min(30, Number(req.body.vatPercent) || 0)),
        metaTitle: str('metaTitle'),
        metaDescription: str('metaDescription'),
        facebookUrl: str('facebookUrl'),
        youtubeUrl: str('youtubeUrl'),
        linkedinUrl: str('linkedinUrl'),
        maintenanceMode: req.body.maintenanceMode === 'on',
      },
    });

    await audit.log(req, 'settings.updated', { detail: 'Site settings saved' });

    req.flash('success', 'Settings saved.');
    return res.redirect('/admin/settings');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
