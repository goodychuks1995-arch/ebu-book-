const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const db = require('../config/db');

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
      'SELECT id, title, body, created_at FROM news ORDER BY created_at DESC LIMIT 50'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { title, body } = req.body;
    if (!title?.trim() || !body?.trim()) {
      const err = new Error('Title and body are required');
      err.status = 400;
      throw err;
    }
    const { rows } = await db.query(
      'INSERT INTO news (title, body) VALUES ($1, $2) RETURNING id, title, body, created_at',
      [title.trim(), body.trim()]
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
