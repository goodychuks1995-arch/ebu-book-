const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();

const requireAuth = require('../middleware/requireAuth');
const supabase = require('../config/supabase');
const { getArticleById } = require('../models/articleModel');
const { createPayment, findPaymentByReference, updatePaymentStatus } = require('../models/paymentModel');
const { createPurchase, findPurchase } = require('../models/purchaseModel');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, ['image/jpeg', 'image/png', 'application/pdf'].includes(file.mimetype)),
});

const httpError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

const requireAdmin = (req, res, next) =>
  req.user && req.user.role === 'admin' ? next() : next(httpError(403, 'Admins only'));

// POST /api/payments/manual — student uploads proof of bank transfer
router.post('/manual', requireAuth, upload.single('proof'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'Upload a JPG, PNG or PDF (max 5 MB).');

    const article = await getArticleById(req.body.articleId);
    if (!article || !article.is_premium) throw httpError(400, 'Invalid article');

    const owned = await findPurchase(req.user.id, article.id);
    if (owned) throw httpError(409, 'You already own this item');

    const reference = `MAN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const ext = { 'application/pdf': 'pdf', 'image/png': 'png' }[req.file.mimetype] || 'jpg';
    const proofPath = `${req.user.id}/${reference}.${ext}`;

    const up = await supabase.storage
      .from('payment-proofs')
      .upload(proofPath, req.file.buffer, { contentType: req.file.mimetype });
    if (up.error) throw httpError(500, 'Upload failed. Try again.');

    const { data, error } = await supabase
      .from('manual_payments')
      .insert({
        user_id: req.user.id,
        article_id: article.id,
        amount_kobo: article.price_kobo,
        reference,
        proof_path: proofPath,
      })
      .select()
      .single();

    if (error) {
      await supabase.storage.from('payment-proofs').remove([proofPath]);
      throw httpError(
        error.code === '23505' ? 409 : 500,
        error.code === '23505' ? 'You already have a pending request for this item' : 'Could not save request',
      );
    }
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/payments/manual/mine — student sees own requests
router.get('/manual/mine', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('manual_payments')
      .select('id, article_id, reference, status, note, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    next(err);
  }
});

// GET /api/payments/admin/manual — admin lists requests (?status=pending)
router.get('/admin/manual', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const { data: rows, error } = await supabase
      .from('manual_payments')
      .select('*')
      .eq('status', status)
      .order('created_at');
    if (error) throw error;

    const list = await Promise.all(
      (rows || []).map(async (r) => {
        const article = await getArticleById(r.article_id);
        const { data: signed } = await supabase.storage
          .from('payment-proofs')
          .createSignedUrl(r.proof_path, 600);
        const { data: user } = await supabase
          .from('users')
          .select('name, email')
          .eq('id', r.user_id)
          .maybeSingle();
        return {
          ...r,
          article_title: article?.title,
          user_name: user?.name,
          user_email: user?.email,
          proof_url: signed?.signedUrl,
        };
      }),
    );
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// POST /api/payments/admin/manual/:id/approve
router.post('/admin/manual/:id/approve', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { data: p } = await supabase
      .from('manual_payments')
      .select('*')
      .eq('id', req.params.id)
      .eq('status', 'pending')
      .maybeSingle();
    if (!p) throw httpError(404, 'Not found or already reviewed');

    const already = await findPurchase(p.user_id, p.article_id);
    if (!already) {
      await createPayment({
        userId: p.user_id,
        articleId: p.article_id,
        amountKobo: p.amount_kobo,
        paystackReference: p.reference,
      });
      await updatePaymentStatus(p.reference, 'success');
      const payment = await findPaymentByReference(p.reference);
      await createPurchase({ userId: p.user_id, articleId: p.article_id, paymentId: payment.id });
    }

    await supabase
      .from('manual_payments')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', p.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/payments/admin/manual/:id/reject
router.post('/admin/manual/:id/reject', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await supabase
      .from('manual_payments')
      .update({
        status: 'rejected',
        note: (req.body && req.body.note) || 'Payment not found',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('status', 'pending');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
