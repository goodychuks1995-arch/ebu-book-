require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./config/db');
const { findPaymentByReference, updatePaymentStatus } = require('./models/paymentModel');
const { createPurchase } = require('./models/purchaseModel');
const rateLimit = require('express-rate-limit');

const app = express();


const authRoutes = require('./routes/authRoutes');
const articleRoutes = require('./routes/articleRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const purchaseRoutes = require('./routes/purchaseRoutes');
const downloadRoutes = require('./routes/downloadRoutes');
const errorHandler = require('./middleware/errorHandler');


app.use(cors());

// Paystack's webhook signature is computed over the RAW request body, so this
// route must be registered with express.raw() BEFORE the global express.json()
// below — otherwise the signature check will always fail.
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest('hex');

  if (hash !== signature) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body.toString('utf8'));

  if (event.event === 'charge.success') {
    const { reference } = event.data;
    try {
      const payment = await findPaymentByReference(reference);
      if (payment && payment.status !== 'success') {
        await updatePaymentStatus(reference, 'success');
        await createPurchase({ userId: payment.user_id, articleId: payment.article_id, paymentId: payment.id });
      }
    } catch (err) {
      console.error('Webhook processing error:', err);
    }
  }

  res.sendStatus(200);
});

app.use(express.json());

const limiter = (windowMs, limit, error, extra = {}) =>
  rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error }, ...extra });

// Everything under /api: 120 requests a minute per visitor
app.use('/api', limiter(60 * 1000, 120, 'Too many requests. Please slow down.'));

// Login and signup: 10 failed tries per 15 minutes (successful logins don't count)
app.use('/api/auth', limiter(15 * 60 * 1000, 10, 'Too many attempts. Try again in 15 minutes.', { skipSuccessfulRequests: true }));

// Downloads and reading: 40 per 10 minutes, so files can't be scraped
app.use('/api/downloads', limiter(10 * 60 * 1000, 40, 'Too many download requests. Try again shortly.'));

// Health check — also confirms the DB connection is alive
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', provider: process.env.SUPABASE_DB_URL ? 'supabase' : 'postgres' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected', message: err.message });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/downloads', downloadRoutes);
app.use('/api/news', require('./routes/newsRoutes'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Centralized error handler (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
