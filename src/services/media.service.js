'use strict';

/**
 * Media library.
 *
 * Files are written to UPLOAD_DIR (public/uploads by default) and recorded in the
 * MediaAsset table. The database row is the source of truth for what the library
 * contains; the bytes on disk are what get served.
 *
 * Uploads are validated by BOTH extension and magic bytes. A client-supplied
 * MIME type is a hint, never a fact -- trusting it would let a .php or .svg-with-
 * script through under a fake image/png header. Only formats on the ALLOWED list
 * are accepted, and the extension is rewritten from the sniffed type rather than
 * taken from the uploaded filename.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const config = require('../config');
const prisma = require('../config/prisma');

const UPLOAD_ROOT = path.resolve(config.rootDir, config.upload.dir);

// Formats we are willing to serve back. Deliberately no SVG: it is XML and can
// carry <script>, which would execute on our own origin. If an operator needs a
// custom SVG logo they can place it under public/images/ by hand.
const ALLOWED = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

const FOLDERS = ['general', 'payments', 'blog', 'portfolio', 'services', 'packages'];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Sniff the real type from the first bytes. Returns a MIME string or null.
 */
function sniffMime(buf) {
  if (buf.length < 12) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // GIF
  if (buf.slice(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  // ICO
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
  // RIFF....WEBP
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  // ISO-BMFF: ....ftypavif
  if (buf.slice(4, 8).toString('latin1') === 'ftyp' && buf.slice(8, 12).toString('latin1').startsWith('avif')) {
    return 'image/avif';
  }
  return null;
}

/**
 * Read intrinsic dimensions from the file header.
 *
 * Done by hand rather than pulling in an image library: the four formats below
 * cover everything we accept, and the header offsets are stable. Returns nulls
 * when a format is not understood -- dimensions are a nicety (they let templates
 * emit width/height and avoid layout shift), never a reason to reject a file.
 */
function readDimensions(buf) {
  const none = { width: null, height: null };
  try {
    // ---- PNG: IHDR is always the first chunk, at a fixed offset ----
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }

    // ---- GIF: logical screen descriptor, little-endian ----
    if (buf.slice(0, 3).toString('latin1') === 'GIF') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }

    // ---- WebP: three sub-formats, each storing size differently ----
    if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') {
      const fourCC = buf.slice(12, 16).toString('latin1');
      if (fourCC === 'VP8 ') {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (fourCC === 'VP8L') {
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (fourCC === 'VP8X') {
        const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
        const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
        return { width: w, height: h };
      }
      return none;
    }

    // ---- JPEG: walk the segment markers until a Start-Of-Frame ----
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry the frame size.
        const isSOF = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
          || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
        if (isSOF) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        const len = buf.readUInt16BE(i + 2);
        if (len <= 0) break;
        i += 2 + len;
      }
      return none;
    }
  } catch {
    return none;
  }
  return none;
}

/** Random on-disk name. Never derived from user input, so no traversal risk. */
function diskName(ext) {
  return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

/** Public URL for a stored file. */
function publicUrl(filename) {
  const rel = path.relative(path.join(config.rootDir, 'public'), UPLOAD_ROOT);
  return '/' + path.posix.join(rel.split(path.sep).join('/'), filename);
}

/**
 * Validate and persist one upload. `file` is a multer memory-storage file.
 * Throws an Error with a user-facing `.message` on rejection.
 */
async function storeUpload(file, { folder = 'general', altText = '', userId = null } = {}) {
  if (!file || !file.buffer) throw new Error('No file was received.');

  const maxMb = Math.round(config.upload.maxBytes / (1024 * 1024));
  if (file.size > config.upload.maxBytes) {
    throw new Error(`That file is larger than the ${maxMb} MB limit.`);
  }

  // Trust the bytes, not the client-supplied content type.
  const mime = sniffMime(file.buffer);
  if (!mime || !ALLOWED[mime]) {
    throw new Error('Only PNG, JPEG, GIF, WebP, AVIF and ICO images are accepted.');
  }

  const ext = ALLOWED[mime];
  const safeFolder = FOLDERS.includes(folder) ? folder : 'general';
  const dir = path.join(UPLOAD_ROOT, safeFolder);
  ensureDir(dir);

  const filename = diskName(ext);
  await fsp.writeFile(path.join(dir, filename), file.buffer);

  const { width, height } = readDimensions(file.buffer);

  const asset = await prisma.mediaAsset.create({
    data: {
      filename: path.posix.join(safeFolder, filename),
      originalName: String(file.originalname || 'upload').slice(0, 200),
      url: publicUrl(path.posix.join(safeFolder, filename)),
      mimeType: mime,
      sizeBytes: file.size,
      width,
      height,
      altText: String(altText || '').slice(0, 200),
      folder: safeFolder,
      uploadedById: userId || null,
    },
  });

  return asset;
}

/** Remove a row and its bytes. Tolerates a missing file on disk. */
async function deleteAsset(id) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) return false;

  const abs = path.join(UPLOAD_ROOT, asset.filename);
  // Guard against a filename that somehow escapes the upload root.
  if (abs.startsWith(UPLOAD_ROOT)) {
    await fsp.unlink(abs).catch(() => {});
  }
  await prisma.mediaAsset.delete({ where: { id } });
  return true;
}

/** Paginated listing for the media library screen. */
async function list({ folder, q, take = 60, skip = 0 } = {}) {
  const where = {};
  if (folder && FOLDERS.includes(folder)) where.folder = folder;
  if (q) {
    where.OR = [
      { originalName: { contains: String(q) } },
      { altText: { contains: String(q) } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.mediaAsset.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
    prisma.mediaAsset.count({ where }),
  ]);
  return { items, total };
}

module.exports = {
  UPLOAD_ROOT,
  FOLDERS,
  ALLOWED,
  storeUpload,
  deleteAsset,
  list,
  sniffMime,
  readDimensions,
};
