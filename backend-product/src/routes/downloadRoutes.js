const express = require('express');
const path = require('path');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const db = require('../config/db');
const supabase = require('../config/supabase');
const { getArticleById } = require('../models/articleModel');
const { findPurchase } = require('../models/purchaseModel');

// GET /api/downloads/:articleId — returns a short-lived download link if the user owns it
// GET /api/downloads/:articleId/view — link for reading in the browser
router.get('/:articleId/view', requireAuth, async (req, res, next) => {
  try {
    const { articleId } = req.params;
    const article = await getArticleById(articleId);
    if (!article) {
      const err = new Error('Article not found');
      err.status = 404;
      throw err;
    }

    if (article.is_premium) {
      const owns = await findPurchase(req.user.id, articleId);
      if (!owns) {
        const err = new Error('You have not purchased this item');
        err.status = 403;
        throw err;
      }
    }

    const { data, error } = await supabase.storage
      .from('articles')
      .createSignedUrl(article.file_path, 600);

    if (error) {
      console.error('Signed URL error:', error.message);
      const err = new Error('Could not open this note');
      err.status = 500;
      throw err;
    }

    res.json({ url: data.signedUrl });
  } catch (err) {
    next(err);
  }
});
module.exports = router;
