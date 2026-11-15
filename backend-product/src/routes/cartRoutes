const express = require('express');
const crypto = require('crypto');
const requireAuth = require('../middleware/requireAuth');
const db = require('../config/db');

const router = express.Router();

async function paystack(path, options = {}) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.status) {
    const err = new Error(body.message || 'Payment provider error');
    err.status = 502;
    throw err;
  }
  return body.data;
}

// Safe to run twice: grants access to every note in the order, then marks it paid.
async function fulfillOrder(reference, paidAmountKobo) {
  await db.query(
    `INSERT INTO purchases (user_id, article_id)
     SELECT o.user_id, i.article_id
     FROM orders o JOIN order_items i ON i.order_id = o.id
     WHERE o.reference = $1 AND o.amount_kobo = $2
       AND NOT EXISTS (
         SELECT 1 FROM purchases p WHERE p.user_id = o.user_id AND p.article_id = i.article_id
       )`,
    [reference, paidAmountKobo]
  );
  const { rowCount } = await db.query(
    `UPDATE orders SET status = 'paid' WHERE reference = $1 AND amount_kobo = $2`,
    [reference, paidAmountKobo]
  );
  return rowCount > 0;
}

const fail = (message, status) => Object.assign(new Error(message), { status });

// POST /api/cart/checkout  { articleIds: [1, 2, 3] }
router.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    const ids = [...new Set((req.body.articleIds || []).map(Number))]
      .filter(Number.isInteger)
      .slice(0, 30);
    if (!ids.length) throw fail('Your cart is empty', 400);

    // Prices always come from the database, never from the browser.
    const { rows: items } = await db.query(
      `SELECT a.id, a.price_kobo FROM articles a
       WHERE a.id = ANY($1::int[]) AND a.published = true
         AND a.is_premium = true AND a.price_kobo > 0
         AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.user_id = $2 AND p.article_id = a.id)`,
      [ids, req.user.id]
    );
    if (!items.length) throw fail('Nothing to pay for. You may already own these notes.', 400);

    const total = items.reduce((sum, item) => sum + Number(item.price_kobo), 0);
    const reference = `CART-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const { rows } = await db.query(
      'INSERT INTO orders (user_id, reference, amount_kobo) VALUES ($1, $2, $3) RETURNING id',
      [req.user.id, reference, total]
    );
    for (const item of items) {
      await db.query(
        'INSERT INTO order_items (order_id, article_id, price_kobo) VALUES ($1, $2, $3)',
        [rows[0].id, item.id, item.price_kobo]
      );
    }

    const frontend = (process.env.FRONTEND_URL || '').split(',')[0].trim();
    const init = await paystack('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: req.user.email,
        amount: total,
        currency: 'NGN',
        reference,
        callback_url: frontend || undefined,
      }),
    });
    res.json({ authorization_url: init.authorization_url, reference });
  } catch (err) {
    next(err);
  }
});

// GET /api/cart/verify/:reference  (called when the buyer returns from Paystack)
router.get('/verify/:reference', requireAuth, async (req, res, next) => {
  try {
    const { reference } = req.params;
    const { rows } = await db.query(
      'SELECT id, amount_kobo, status FROM orders WHERE reference = $1 AND user_id = $2',
      [reference, req.user.id]
    );
    const order = rows[0];
    if (!order) throw fail('Order not found', 404);
    if (order.status === 'paid') return res.json({ status: 'success' });

    const tx = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (tx.status !== 'success' || Number(tx.amount) !== Number(order.amount_kobo)) {
      throw fail('Payment not confirmed yet', 400);
    }
    await fulfillOrder(reference, Number(tx.amount));
    res.json({ status: 'success' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.fulfillOrder = fulfillOrder;
