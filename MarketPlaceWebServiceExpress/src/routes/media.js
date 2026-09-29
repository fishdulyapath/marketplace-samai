const express = require('express');
const { requireAdmin } = require('../auth/requireAdmin');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const DATA_DIR = process.env.MARKETPLACE_DATA_DIR || path.join(__dirname, '../../data');
const MEDIA_DIR = process.env.MARKETPLACE_MEDIA_DIR || path.join(DATA_DIR, 'media');
const publicBasePath = '/media';
const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['video/ogg', 'ogv'],
]);

router.get('/media', async (req, res) => {
  try {
    const files = await listMedia(req);
    return res.json({ success: true, data: files });
  } catch (error) {
    return res.status(500).json({ success: false, ERROR: error.message });
  }
});

router.post('/media/upload', requireAdmin('admin.content'), async (req, res) => {
  try {
    const { dataUrl, fileName = '' } = req.body || {};
    const parsed = parseDataUrl(dataUrl);
    const ext = allowedTypes.get(parsed.mimeType);
    if (!ext) {
      return res.status(400).json({ success: false, ERROR: 'Unsupported image type' });
    }
    const maxBytes = parsed.mimeType.startsWith('video/') ? 80 * 1024 * 1024 : 8 * 1024 * 1024;
    if (parsed.buffer.length > maxBytes) {
      return res.status(400).json({ success: false, ERROR: parsed.mimeType.startsWith('video/') ? 'Video is larger than 80MB' : 'Image is larger than 8MB' });
    }

    const safeName = createFileName(fileName, ext);
    await fs.mkdir(MEDIA_DIR, { recursive: true });
    await fs.writeFile(path.join(MEDIA_DIR, safeName), parsed.buffer);

    const asset = await getMediaAsset(req, safeName);
    return res.json({ success: true, data: asset });
  } catch (error) {
    return res.status(400).json({ success: false, ERROR: error.message });
  }
});

router.post('/media/rename', requireAdmin('admin.content'), async (req, res) => {
  try {
    const { name, newName } = req.body || {};
    const currentName = cleanExistingFileName(name);
    const safeNewName = createRenameFileName(newName, path.extname(currentName));
    const currentPath = getMediaPath(currentName);
    const nextPath = getMediaPath(safeNewName);
    if (currentName !== safeNewName) {
      try {
        await fs.access(nextPath);
        throw new Error('File name already exists');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await fs.rename(currentPath, nextPath);
    const asset = await getMediaAsset(req, safeNewName);
    return res.json({
      success: true,
      data: {
        asset,
        oldName: currentName,
        oldUrl: `${getOrigin(req)}${publicBasePath}/${encodeURIComponent(currentName)}`,
      },
    });
  } catch (error) {
    return res.status(400).json({ success: false, ERROR: error.message });
  }
});

router.post('/media/delete', requireAdmin('admin.content'), async (req, res) => {
  try {
    const { name } = req.body || {};
    const safeName = cleanExistingFileName(name);
    await fs.unlink(getMediaPath(safeName));
    return res.json({
      success: true,
      data: {
        name: safeName,
        url: `${getOrigin(req)}${publicBasePath}/${encodeURIComponent(safeName)}`,
      },
    });
  } catch (error) {
    return res.status(400).json({ success: false, ERROR: error.message });
  }
});

async function listMedia(req) {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const names = await fs.readdir(MEDIA_DIR);
  const assets = await Promise.all(
    names
      .filter((name) => /\.(jpe?g|png|webp|gif|mp4|webm|ogv)$/i.test(name))
      .map((name) => getMediaAsset(req, name))
  );
  return assets.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function getMediaAsset(req, name) {
  const stat = await fs.stat(getMediaPath(name));
  return {
    name,
    url: `${getOrigin(req)}${publicBasePath}/${encodeURIComponent(name)}`,
    path: `${publicBasePath}/${name}`,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
  };
}

function parseDataUrl(value) {
  const text = String(value || '');
  const match = text.match(/^data:((?:image|video)\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Invalid media data');
  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function createFileName(fileName, ext) {
  const base = path
    .basename(String(fileName || 'banner'), path.extname(String(fileName || 'banner')))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'banner';
  return `${Date.now()}-${base}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
}

function createRenameFileName(fileName, ext) {
  const base = path
    .basename(String(fileName || 'banner'), path.extname(String(fileName || 'banner')))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!base) throw new Error('Invalid file name');
  const normalizedExt = String(ext || '').toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.ogv'].includes(normalizedExt)) {
    throw new Error('Unsupported media type');
  }
  return `${base}${normalizedExt}`;
}

function cleanExistingFileName(name) {
  const safeName = path.basename(String(name || ''));
  if (!safeName || safeName !== String(name || '')) throw new Error('Invalid file name');
  if (!/\.(jpe?g|png|webp|gif|mp4|webm|ogv)$/i.test(safeName)) throw new Error('Unsupported media type');
  return safeName;
}

function getMediaPath(name) {
  const safeName = cleanExistingFileName(name);
  return path.join(MEDIA_DIR, safeName);
}

function getOrigin(req) {
  const publicUrl = String(process.env.MARKETPLACE_PUBLIC_URL || '').replace(/\/$/, '');
  if (publicUrl) return publicUrl;
  const forwardedProto = req.get('x-forwarded-proto');
  const forwardedHost = req.get('x-forwarded-host');
  const proto = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host');
  return `${proto}://${host}`;
}

module.exports = router;
module.exports.MEDIA_DIR = MEDIA_DIR;
