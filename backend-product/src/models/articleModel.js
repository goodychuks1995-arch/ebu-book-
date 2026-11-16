const db = require('../config/db');

async function getAllArticles() {
  const result = await db.query(
    `SELECT id, title, slug, description, preview_text, price_kobo, is_premium, created_at, file_path
     FROM articles
     WHERE published = TRUE
     ORDER BY created_at DESC`
  );
  return result.rows;
}

async function getArticleBySlug(slug) {
  const result = await db.query('SELECT * FROM articles WHERE slug = $1', [slug]);
  return result.rows[0] || null;
}

async function getArticleById(id) {
  const result = await db.query('SELECT * FROM articles WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function createArticle({ title, slug, description, previewText, filePath, priceKobo = 0, isPremium = false }) {
  const result = await db.query(
    `INSERT INTO articles (title, slug, description, preview_text, file_path, price_kobo, is_premium)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [title, slug, description, previewText, filePath, priceKobo, isPremium]
  );
  return result.rows[0];
}

module.exports = { getAllArticles, getArticleBySlug, getArticleById, createArticle };
