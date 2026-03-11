const express = require('express');
const router = express.Router();
const Order = require('../models/Order.model');
const Driver = require('../models/Driver.model');
const User = require('../models/User.model');
const Notification = require('../models/Notification.model');
const { protect, requireRole } = require('../utility/Auth');
const { emitToUser, emitToDriver, emitToAdmins } = require('../Socket/SocketHandler');
const { getRevenue } = require('../controllers/Admin.controller');

// Get all orders
router.get('/orders', protect, requireRole('admin'), async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const query = {};
    if (status) query.status = status;

    const orders = await Order.find(query)
      .populate('user', 'name email phone')
      .populate('driver', 'name phone vehicleType vehiclePlate isOnline')
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
router.get('/stats', protect, requireRole('admin'), async (req, res) => {
  try {
    const [
      totalOrders,
      pendingOrders,
      activeOrders,
      deliveredOrders,
      cancelledOrders,
      totalDrivers,
      onlineDrivers,
      totalUsers,
      recentOrders
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: 'pending' }),
      Order.countDocuments({ status: { $in: ['confirmed', 'assigned', 'picked_up', 'in_transit', 'out_for_delivery'] } }),
      Order.countDocuments({ status: 'delivered' }),
      Order.countDocuments({ status: 'cancelled' }),
      Driver.countDocuments(),
      Driver.countDocuments({ isOnline: true }),
      User.countDocuments({ role: 'user' }),
      Order.find().sort({ createdAt: -1 }).limit(5)
        .populate('user', 'name')
        .populate('driver', 'name')
    ]);

    res.json({
      totalOrders, pendingOrders, activeOrders, deliveredOrders,
      cancelledOrders, totalDrivers, onlineDrivers, totalUsers, recentOrders
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

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
router.patch('/orders/:id/assign-driver', protect, requireRole('admin'), async (req, res) => {
  try {
    const { driverId } = req.body;
    if (!driverId) return res.status(400).json({ message: 'driverId is required' });

    const order = await Order.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('driver', 'name phone');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const driver = await Driver.findById(driverId);
    if (!driver) return res.status(404).json({ message: 'Driver not found' });

    order.driver = driverId;
    order.status = 'assigned';
    order.trackingHistory.push({
      status: 'assigned',
      message: `Driver ${driver.name} has been assigned to your order.`,
      updatedBy: { role: 'admin', id: req.user._id, name: req.user.name }
    });
    await order.save();
    await order.populate('driver', 'name phone vehicleType vehiclePlate');

    // Notify the driver
    await Notification.create({
      recipient: driverId,
      recipientModel: 'Driver',
      recipientRole: 'driver',
      title: 'New Delivery Assignment',
      message: `You have been assigned order ${order.orderNumber}. Please pick up from ${order.pickup.address}, ${order.pickup.city}.`,
      type: 'driver_assigned',
      orderId: order._id,
      orderNumber: order.orderNumber
    });
    emitToDriver(req.io, driverId, 'order_assigned', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      message: `You have been assigned order ${order.orderNumber}`,
      order
    });

    // Notify the user
    await Notification.create({
      recipient: order.user._id,
      recipientModel: 'User',
      recipientRole: 'user',
      title: 'Driver Assigned',
      message: `Driver ${driver.name} has been assigned to your order ${order.orderNumber}.`,
      type: 'order_assigned',
      orderId: order._id,
      orderNumber: order.orderNumber
    });
    emitToUser(req.io, order.user._id.toString(), 'order_update', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      status: 'assigned',
      message: `Driver ${driver.name} has been assigned to your order!`,
      driver: { name: driver.name, phone: driver.phone, vehicleType: driver.vehicleType, vehiclePlate: driver.vehiclePlate }
    });

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mark order as delivered (admin)
router.patch('/orders/:id/mark-delivered', protect, requireRole('admin'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('driver', 'name');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (order.status === 'delivered') {
      return res.status(400).json({ message: 'Order already delivered' });
    }

    order.status = 'delivered';
    order.actualDelivery = new Date();
    order.trackingHistory.push({
      status: 'delivered',
      message: 'Package has been successfully delivered.',
      updatedBy: { role: 'admin', id: req.user._id, name: req.user.name }
    });
    await order.save();

    // Update driver stats
    if (order.driver) {
      await Driver.findByIdAndUpdate(order.driver._id, {
        $inc: { totalDeliveries: 1 },
        isAvailable: true
      });
    }

    // Notify user
    await Notification.create({
      recipient: order.user._id,
      recipientModel: 'User',
      recipientRole: 'user',
      title: 'Order Delivered! 🎉',
      message: `Your order ${order.orderNumber} has been delivered successfully.`,
      type: 'order_delivered',
      orderId: order._id,
      orderNumber: order.orderNumber
    });
    emitToUser(req.io, order.user._id.toString(), 'order_update', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      status: 'delivered',
      message: '🎉 Your package has been delivered!'
    });

    // Notify driver
    if (order.driver) {
      emitToDriver(req.io, order.driver._id.toString(), 'order_delivered', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        message: `Order ${order.orderNumber} marked as delivered.`
      });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get admin notifications
router.get('/notifications', protect, requireRole('admin'), async (req, res) => {
  try {
    const notifications = await Notification.find({ recipientRole: 'admin' })
      .sort({ createdAt: -1 })
      .limit(50);
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

router.get('/revenue', protect, requireRole('admin'), getRevenue);


module.exports = router;