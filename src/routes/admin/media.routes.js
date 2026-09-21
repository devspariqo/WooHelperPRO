'use strict';

/**
 * Admin media library.
 *
 * Uploads return JSON because the picker is driven by fetch() from the settings
 * and content forms -- the page must not navigate away mid-edit. Deletion and
 * alt-text edits are plain form posts, since those are deliberate standalone
 * actions and a redirect back to the library is the right outcome.
 */

const express = require('express');

const prisma = require('../../config/prisma');
const media = require('../../services/media.service');
const audit = require('../../services/audit.service');
const { requirePermission } = require('../../middleware/auth');
const upload = require('../../middleware/upload');

const router = express.Router();

// ---------------------------------------------------------------
// Library
// ---------------------------------------------------------------
router.get('/media', requirePermission('media'), async (req, res, next) => {
  try {
    const folder = media.FOLDERS.includes(req.query.folder) ? req.query.folder : '';
    const q = String(req.query.q || '').trim();
    const { items, total } = await media.list({ folder: folder || undefined, q: q || undefined });

    res.render('admin/media/index', {
      title: 'Media library',
      layout: 'layouts/dashboard',
      bodyClass: 'admin-page',
      panel: 'admin',
      active: 'media',
      metaTitle: 'Media library — WooHelperPro admin',
      items,
      total,
      folder,
      q,
      folders: media.FOLDERS,
      maxMb: Math.round(require('../../config').upload.maxBytes / (1024 * 1024)),
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// Upload (JSON, for the picker)
// ---------------------------------------------------------------
router.post(
  '/media/upload',
  requirePermission('media'),
  upload.single('file'),
  upload.handleErrors,
  async (req, res) => {
    try {
      const asset = await media.storeUpload(req.file, {
        folder: String(req.body.folder || 'general'),
        altText: String(req.body.altText || ''),
        userId: req.user ? req.user.id : null,
      });

      await audit.log(req, 'media.uploaded', { detail: `${asset.originalName} -> ${asset.url}` });

      return res.json({
        ok: true,
        asset: {
          id: asset.id,
          url: asset.url,
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          originalName: asset.originalName,
        },
      });
    } catch (err) {
      // Validation failures are the user's to fix, so report them as 400 rather
      // than letting them surface as a 500 with a stack trace.
      return res.status(400).json({ ok: false, error: err.message || 'Upload failed.' });
    }
  },
);

// ---------------------------------------------------------------
// Alt text
// ---------------------------------------------------------------
router.post('/media/:id', requirePermission('media'), async (req, res, next) => {
  try {
    await prisma.mediaAsset.update({
      where: { id: req.params.id },
      data: { altText: String(req.body.altText || '').slice(0, 200) },
    });
    req.flash('success', 'Alt text saved.');
    return res.redirect('/admin/media');
  } catch (err) {
    if (err.code === 'P2025') {
      req.flash('error', 'That file no longer exists.');
      return res.redirect('/admin/media');
    }
    return next(err);
  }
});

// ---------------------------------------------------------------
// Delete
// ---------------------------------------------------------------
router.post('/media/:id/delete', requirePermission('media'), async (req, res, next) => {
  try {
    const removed = await media.deleteAsset(req.params.id);
    if (removed) await audit.log(req, 'media.deleted', { detail: req.params.id });
    req.flash(removed ? 'success' : 'error', removed ? 'File deleted.' : 'That file no longer exists.');
    return res.redirect('/admin/media');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------
// JSON listing, for the picker modal to refresh without a reload
// ---------------------------------------------------------------
router.get('/media/list.json', requirePermission('media'), async (req, res, next) => {
  try {
    const { items } = await media.list({
      folder: req.query.folder,
      q: String(req.query.q || '').trim() || undefined,
    });
    return res.json({
      ok: true,
      items: items.map((a) => ({
        id: a.id, url: a.url, width: a.width, height: a.height,
        mimeType: a.mimeType, altText: a.altText, originalName: a.originalName,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
