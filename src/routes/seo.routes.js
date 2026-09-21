'use strict';

/**
 * Generated SEO endpoints: /sitemap.xml and /robots.txt.
 *
 * Both read the SiteSetting row on each request rather than caching, so publishing
 * a service or a blog post is reflected immediately without a rebuild or a restart.
 * The queries are small and indexed, and crawlers hit these rarely.
 *
 * Mounted at the app root (not under a prefix) because both paths are fixed by
 * convention -- /robots.txt in particular must be at the origin root.
 */

const express = require('express');

const prisma = require('../config/prisma');
const config = require('../config');

const router = express.Router();

/** XML-escape a value destined for a <loc> or attribute. */
function xml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const iso = (d) => new Date(d || Date.now()).toISOString().slice(0, 10);

async function settings() {
  try {
    return (await prisma.siteSetting.findUnique({ where: { id: 'singleton' } })) || {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------
// /sitemap.xml
// ---------------------------------------------------------------
router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const s = await settings();
    if (s.sitemapEnabled === false) {
      return res.status(404).type('text/plain').send('Sitemap disabled.');
    }

    const base = (config.appUrl || '').replace(/\/$/, '');

    // Static pages: path, priority, change frequency.
    const statics = [
      ['/', '1.0', 'daily'],
      ['/services', '0.9', 'weekly'],
      ['/packages', '0.9', 'weekly'],
      ['/portfolio', '0.8', 'weekly'],
      ['/blog', '0.8', 'daily'],
      ['/about', '0.6', 'monthly'],
      ['/contact', '0.6', 'monthly'],
      ['/legal/privacy', '0.3', 'yearly'],
      ['/legal/terms', '0.3', 'yearly'],
      ['/legal/refund', '0.3', 'yearly'],
    ];

    // Dynamic pages, fetched in parallel. Each query is limited and ordered so a
    // runaway table cannot make the sitemap enormous.
    //
    // Field names below are taken from prisma/schema.prisma, not assumed:
    //  - Service uses `status: 'ACTIVE'` (not isPublished)
    //  - BlogPost uses `status: 'PUBLISHED'` (not isPublished)
    //
    // Portfolio items are deliberately NOT listed individually: there is no
    // /portfolio/:slug route in public.routes.js, only the /portfolio index. A
    // sitemap that points at 404s is worse than one that omits them.
    const [services, packages, posts] = await Promise.all([
      prisma.service.findMany({
        where: { status: 'ACTIVE' }, select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' }, take: 500,
      }),
      prisma.package.findMany({
        where: { isActive: true }, select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' }, take: 500,
      }),
      prisma.blogPost.findMany({
        where: { status: 'PUBLISHED' }, select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' }, take: 1000,
      }),
    ]);

    const urls = [
      ...statics.map(([path, priority, freq]) => ({ loc: base + path, priority, freq, lastmod: null })),
      ...services.map((r) => ({ loc: `${base}/services/${r.slug}`, priority: '0.7', freq: 'monthly', lastmod: r.updatedAt })),
      ...packages.map((r) => ({ loc: `${base}/packages/${r.slug}`, priority: '0.8', freq: 'weekly', lastmod: r.updatedAt })),
      ...posts.map((r) => ({ loc: `${base}/blog/${r.slug}`, priority: '0.6', freq: 'monthly', lastmod: r.updatedAt })),
    ];

    const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${xml(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${iso(u.lastmod)}</lastmod>` : ''}
    <changefreq>${u.freq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    res.type('application/xml').send(body);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// /robots.txt
// ---------------------------------------------------------------
router.get('/robots.txt', async (req, res, next) => {
  try {
    const s = await settings();
    const base = (config.appUrl || '').replace(/\/$/, '');

    // A custom body replaces the generated file outright. Documented in the
    // settings screen, because it also means the sitemap line is now the
    // operator's responsibility.
    if (s.robotsTxt && s.robotsTxt.trim()) {
      return res.type('text/plain').send(s.robotsTxt.trim() + '\n');
    }

    // Private areas are never crawlable, regardless of what the operator adds.
    const always = [
      '/admin',
      '/account',
      '/api',
      '/login',
      '/logout',
      '/register',
      '/forgot-password',
      '/order',
      '/payments',
      '/theme',
      '/lang',
    ];

    const extra = String(s.robotsExtraDisallow || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => (l.startsWith('/') ? l : '/' + l));

    const disallow = [...new Set([...always, ...extra])];

    const lines = [
      'User-agent: *',
      'Allow: /',
      ...disallow.map((p) => `Disallow: ${p}`),
      '',
      `Sitemap: ${base}/sitemap.xml`,
      '',
    ];

    res.type('text/plain').send(lines.join('\n'));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
