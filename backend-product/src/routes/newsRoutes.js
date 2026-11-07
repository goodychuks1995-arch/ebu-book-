const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const db = require('../config/db');
const supabase = require('../config/supabase');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    const err = new Error('Admins only');
    err.status = 403;
    return next(err);
  }
  next();
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, title, body, image_url, created_at FROM news ORDER BY created_at DESC LIMIT 50'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireAdmin, upload.single('image'), async (req, res, next) => {
  try {
    const { title, body } = req.body;
    if (!title?.trim() || !body?.trim()) {
      const err = new Error('Title and body are required');
      err.status = 400;
      throw err;
    }

    let imageUrl = null;
    if (req.file) {
      if (!req.file.mimetype.startsWith('image/')) {
        const err = new Error('Only image files are allowed');
        err.status = 400;
        throw err;
      }
      const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
      const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const { error } = await supabase.storage
        .from('news-images')
        .upload(name, req.file.buffer, { contentType: req.file.mimetype });
      if (error) throw error;
      imageUrl = supabase.storage.from('news-images').getPublicUrl(name).data.publicUrl;
    }

    const { rows } = await db.query(
      'INSERT INTO news (title, body, image_url) VALUES ($1, $2, $3) RETURNING id, title, body, image_url, created_at',
      [title.trim(), body.trim(), imageUrl]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await db.query('DELETE FROM news WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
