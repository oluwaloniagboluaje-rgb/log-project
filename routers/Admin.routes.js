const express = require('express');
const router = express.Router();
const Order = require('../models/Order.model');
const Driver = require('../models/Driver.model');
const User = require('../models/User.model');
const Notification = require('../models/Notification.model');
const { protect, requireRole } = require('../utility/Auth');
const {
  assignDriver, markDelivered, getRevenue,
  getAllDrivers, getAllUsers, getDashboardStats
} = require('../controllers/Admin.controller');

// Safe socket emitters — silent on Vercel
const emitToUser   = (io, userId, event, data)   => { try { if (io) io.to(`user_${userId}`).emit(event, data); } catch {} };
const emitToDriver = (io, driverId, event, data)  => { try { if (io) io.to(`driver_${driverId}`).emit(event, data); } catch {} };

// Get all orders
router.get('/orders', protect, requireRole('admin'), async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const query = {};
    if (status) query.status = status;
    const orders = await Order.find(query)
      .populate('user', 'name email phone avatar')
      .populate('driver', 'name phone vehicleType vehiclePlate isOnline avatar')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    const total = await Order.countDocuments(query);
    res.json({ orders, total });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get dashboard stats
router.get('/stats', protect, requireRole('admin'), getDashboardStats);

// Get all drivers
router.get('/drivers', protect, requireRole('admin'), async (req, res) => {
  try {
    const drivers = await Driver.find({}).select('-password').sort({ createdAt: -1 });
    res.json(drivers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all users
router.get('/users', protect, requireRole('admin'), async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Assign driver to order
router.patch('/orders/:id/assign-driver', protect, requireRole('admin'), assignDriver);

// Mark order as delivered
router.patch('/orders/:id/mark-delivered', protect, requireRole('admin'), markDelivered);

// Get admin notifications
router.get('/notifications', protect, requireRole('admin'), async (req, res) => {
  try {
    const notifications = await Notification.find({ recipientRole: 'admin' })
      .sort({ createdAt: -1 }).limit(50);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mark notification as read
router.patch('/notifications/:id/read', protect, requireRole('admin'), async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mark all as read
router.patch('/notifications/read-all', protect, requireRole('admin'), async (req, res) => {
  try {
    await Notification.updateMany({ recipientRole: 'admin', isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Revenue
router.get('/revenue', protect, requireRole('admin'), getRevenue);

module.exports = router;