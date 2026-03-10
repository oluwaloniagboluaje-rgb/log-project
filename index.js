require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes = require('./routers/Auth.routes');
const orderRoutes = require('./routers/Order.routes');
const driverRoutes = require('./routers/Driver.routes');
const adminRoutes = require('./routers/Admin.routes');

const { initSocket } = require('./Socket/SocketHandler');

const app = express();
const server = http.createServer(app);

// ── ALLOWED ORIGINS ──
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174', 

  process.env.CLIENT_URL
].filter(Boolean);

// ── SOCKET.IO ──
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true
  }
});

// ── MIDDLEWARE ──
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Attach socket.io instance to every request
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ── ROUTES ──
app.use('/api/auth',    authRoutes);
app.use('/api/orders',  orderRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/admin',   adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// ── 404 HANDLER ──
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.originalUrl} not found` });
});

// ── GLOBAL ERROR HANDLER ──
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error'
  });
});

// ── SOCKET.IO INIT ──
initSocket(io);

// ── MONGODB + SERVER START ──
mongoose.connect(process.env.DATABASE_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    server.listen(process.env.PORT || 5000, () => {
      console.log(`🚀 Server running on port ${process.env.PORT || 5000}`);
      console.log(`📡 Allowed origins: ${allowedOrigins.join(', ')}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

module.exports = { io };