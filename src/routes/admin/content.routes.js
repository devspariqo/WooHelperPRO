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

    // Colours are injected straight into a <style> block by the layout, so an
    // unvalidated value is a CSS-injection vector. Accept only 3/6-digit hex and
    // fall back to the stored value rather than writing something dangerous.
    const hex = (key, fallback) => {
      const v = str(key).toLowerCase();
      return /^#[0-9a-f]{6}$/.test(v) || /^#[0-9a-f]{3}$/.test(v) ? v : fallback;
    };

    // Font names become part of a Google Fonts URL, so strip anything that could
    // break out of the query string. Letters, digits, spaces and hyphens only.
    const font = (key, fallback) => {
      const v = str(key).replace(/[^A-Za-z0-9 \-]/g, '').trim();
      return v || fallback;
    };

    const int = (key, fallback, min, max) => {
      const n = Number(req.body[key]);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(min, Math.min(max, Math.round(n)));
    };

    // The analytics ID is echoed into a <script> tag; keep it to the documented
    // character set so nothing else can be injected there.
    const gaId = str('googleAnalyticsId').replace(/[^A-Za-z0-9\-]/g, '');

    const current = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });
    const cur = current || {};

    await prisma.siteSetting.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {
        // --- identity & contact ---
        siteName: str('siteName') || 'WooHelperPro',
        tagline: str('tagline'),
        taglineBn: str('taglineBn'),
        supportEmail: str('supportEmail'),
        supportPhone: str('supportPhone'),
        whatsappNumber: str('whatsappNumber').replace(/[^\d]/g, ''),
        officeAddress: str('officeAddress'),

        // --- branding: logo & favicon ---
        logoUrl: str('logoUrl'),
        logoAlt: str('logoAlt'),
        logoHeightPx: int('logoHeightPx', cur.logoHeightPx ?? 32, 16, 96),
        faviconUrl: str('faviconUrl'),
        // Theme-specific logos and the homepage hero image.
        logoUrlLight: str('logoUrlLight'),
        logoUrlDark: str('logoUrlDark'),
        heroImageUrl: str('heroImageUrl'),
        heroImageAlt: str('heroImageAlt'),

        // --- branding: colours ---
        primaryColor: hex('primaryColor', cur.primaryColor || '#7c3aed'),
        secondaryColor: hex('secondaryColor', cur.secondaryColor || '#17141f'),
        accentColor: hex('accentColor', cur.accentColor || '#ff6600'),

        // --- typography ---
        fontHeading: font('fontHeading', cur.fontHeading || 'Inter'),
        fontBody: font('fontBody', cur.fontBody || 'Inter'),
        fontHeadingBn: font('fontHeadingBn', cur.fontHeadingBn || 'Hind Siliguri'),
        fontBodyBn: font('fontBodyBn', cur.fontBodyBn || 'Hind Siliguri'),

        // --- payment destinations & tax ---
        bkashNumber: str('bkashNumber'),
        nagadNumber: str('nagadNumber'),
        rocketNumber: str('rocketNumber'),
        bankDetails: str('bankDetails'),
        vatPercent: Math.max(0, Math.min(30, Number(req.body.vatPercent) || 0)),

        // --- SEO ---
        metaTitle: str('metaTitle'),
        metaDescription: str('metaDescription'),
        metaKeywords: str('metaKeywords'),
        metaRobots: str('metaRobots') || 'index, follow',
        ogImageUrl: str('ogImageUrl'),
        googleAnalyticsId: gaId,
        googleSiteVerification: str('googleSiteVerification'),
        twitterHandle: str('twitterHandle').replace(/^@+/, ''),

        // --- social ---
        facebookUrl: str('facebookUrl'),
        youtubeUrl: str('youtubeUrl'),
        linkedinUrl: str('linkedinUrl'),

        // --- general ---
        timezone: str('timezone') || 'Asia/Dhaka',
        defaultLanguage: str('defaultLanguage') === 'bn' ? 'bn' : 'en',
        dateFormat: str('dateFormat') || 'DD MMM YYYY',
        footerText: str('footerText'),

        // --- payment method logos ---
        bkashLogoUrl: str('bkashLogoUrl'),
        nagadLogoUrl: str('nagadLogoUrl'),
        rocketLogoUrl: str('rocketLogoUrl'),
        sslcommerzLogoUrl: str('sslcommerzLogoUrl'),
        bankLogoUrl: str('bankLogoUrl'),
        codLogoUrl: str('codLogoUrl'),
        cardLogoUrl: str('cardLogoUrl'),

        // --- outbound mail ---
        smtpHost: str('smtpHost'),
        smtpPort: Math.max(1, Math.min(65535, Number(req.body.smtpPort) || 587)),
        smtpSecure: req.body.smtpSecure === 'on',
        smtpUser: str('smtpUser'),
        // A blank password means "leave the stored one alone" -- otherwise every
        // save would wipe the credential, since the form never echoes it back.
        smtpPassword: str('smtpPassword') || (cur.smtpPassword || ''),
        mailFromName: str('mailFromName'),
        mailFromEmail: str('mailFromEmail'),
        adminNotificationEmail: str('adminNotificationEmail'),
        notifyAdminOnOrder: req.body.notifyAdminOnOrder === 'on',
        notifyAdminOnPayment: req.body.notifyAdminOnPayment === 'on',
        notifyAdminOnTicket: req.body.notifyAdminOnTicket === 'on',
        notifyAdminOnLead: req.body.notifyAdminOnLead === 'on',
        notifyCustomerOnOrder: req.body.notifyCustomerOnOrder === 'on',
        notifyCustomerOnPayment: req.body.notifyCustomerOnPayment === 'on',

        // --- crawling ---
        sitemapEnabled: req.body.sitemapEnabled === 'on',
        robotsTxt: str('robotsTxt'),
        robotsExtraDisallow: str('robotsExtraDisallow'),

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

/**
 * Send a test message using the settings currently in the database.
 *
 * Reports the transport's actual reply rather than a generic success, because the
 * usual failure here is a wrong port or a provider that rejects the from-address,
 * and the operator needs the real error to fix it.
 */
router.post('/settings/test-mail', requirePermission('settings'), async (req, res, next) => {
  try {
    const mailer = require('../../services/mailer.service');
    const settings = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });

    const to = String(req.body.testTo || '').trim()
      || (settings && settings.adminNotificationEmail)
      || (settings && settings.supportEmail)
      || (req.user && req.user.email);

    if (!to) {
      req.flash('error', 'No recipient — set an admin notification address or a support email first.');
      return res.redirect('/admin/settings');
    }

    const result = await mailer.sendTest({ to, settings });

    if (result.queued) {
      req.flash('success', `Test email sent to ${to}.`);
    } else if (result.mode === 'development-log') {
      req.flash('info', `SMTP is not configured, so the message was written to the server log instead of being sent to ${to}.`);
    } else {
      req.flash('error', `Could not send: ${result.error || 'unknown error'}`);
    }
    return res.redirect('/admin/settings');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
