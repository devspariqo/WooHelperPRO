'use strict';

/**
 * Upload middleware.
 *
 * multer is configured with MEMORY storage on purpose. The file is held in a
 * buffer just long enough for media.service to sniff its real type and reject it
 * if it is not an image -- writing straight to disk first would mean a rejected
 * upload had already touched the filesystem, and would leave orphans behind.
 *
 * The service also rewrites the extension from the sniffed MIME type, so nothing
 * about the stored path is derived from the client's filename.
 */

const multer = require('multer');

const config = require('../config');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxBytes,
    files: 10,
  },
});

/** Single file, field name `file` by default. */
const single = (field = 'file') => upload.single(field);

/** Several files under one field. */
const array = (field = 'files', max = 10) => upload.array(field, max);

/**
 * Turns multer's error codes into messages an operator can act on, and forwards
 * everything else. Without this a size overflow surfaces as a bare 500.
 */
function handleErrors(err, req, res, next) {
  if (!err) return next();

  const maxMb = Math.round(config.upload.maxBytes / (1024 * 1024));
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: `That file is larger than the ${maxMb} MB limit.` });
  }
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ ok: false, error: 'Too many files in one upload.' });
  }
  return next(err);
}

module.exports = { single, array, handleErrors, upload };
