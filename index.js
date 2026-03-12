require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const mongoose  = require('mongoose');

const authRoutes   = require('./routers/Auth.routes');
const orderRoutes  = require('./routers/Order.routes');
const driverRoutes = require('./routers/Driver.routes');
const adminRoutes  = require('./routers/Admin.routes');

const app = express();

// ── ALLOWED ORIGINS ──────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.CLIENT_URL,
].filter(Boolean);

// ── MIDDLEWARE ───────────────────────────────────────────────────
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── CACHED DB CONNECTION (required for Vercel serverless) ────────
let isConnected = false;
const connectDB = async () => {
  if (isConnected) return;
  await mongoose.connect(process.env.DATABASE_URI);
  isConnected = true;
  console.log('✅ MongoDB connected');
};

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ message: 'Database connection failed' });
  }
});

// ── ROUTES ───────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/orders',  orderRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/admin',   adminRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// ── 404 ──────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.originalUrl} not found` });
});

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

// ── EXPORT FOR VERCEL ────────────────────────────────────────────
module.exports = app;