const express = require('express');
const path = require('path');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const db = require('../config/db');
const supabase = require('../config/supabase');
const { getArticleById } = require('../models/articleModel');
const { findPurchase } = require('../models/purchaseModel');

// GET /api/downloads/:articleId — returns a short-lived download link if the user owns it
router.get('/:articleId', requireAuth, async (req, res, next) => {
  try {
    const { articleId } = req.params;
    const article = await getArticleById(articleId);
    if (!article) {
      const err = new Error('Article not found');
      err.status = 404;
      throw err;
    }

    // Free articles skip the ownership check; premium ones require a purchase
    if (article.is_premium) {
      const owns = await findPurchase(req.user.id, articleId);
      if (!owns) {
        const err = new Error('You have not purchased this item');
        err.status = 403;
        throw err;
      }
    }

    const fileName = `${article.title}${path.extname(article.file_path)}`;

    const { data, error } = await supabase.storage
      .from('articles')
      .createSignedUrl(article.file_path, 60, { download: fileName });

    if (error) {
      console.error('Signed URL error:', error.message);
      const err = new Error('Could not create download link');
      err.status = 500;
      throw err;
    }

    await db.query('INSERT INTO downloads (user_id, article_id) VALUES ($1, $2)', [req.user.id, articleId]);

    res.json({ url: data.signedUrl });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
