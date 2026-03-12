const Order = require('../models/Order.model');
const Driver = require('../models/Driver.model');
const User = require('../models/User.model');
const Notification = require('../models/Notification.model');

// Safe socket emitters — do nothing if req.io is unavailable (Vercel)
const emitToDriver = (io, driverId, event, data) => {
  try { if (io) io.to(`driver_${driverId}`).emit(event, data); } catch {}
};
const emitToUser = (io, userId, event, data) => {
  try { if (io) io.to(`user_${userId}`).emit(event, data); } catch {}
};

const getDashboardStats = async (req, res) => {
  try {
    const [
      totalOrders, pendingOrders, activeOrders, deliveredOrders,
      cancelledOrders, totalDrivers, onlineDrivers, availableDrivers,
      totalUsers, recentOrders, revenueAgg
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: 'pending' }),
      Order.countDocuments({ status: { $in: ['confirmed', 'assigned', 'picked_up', 'in_transit', 'out_for_delivery'] } }),
      Order.countDocuments({ status: 'delivered' }),
      Order.countDocuments({ status: 'cancelled' }),
      Driver.countDocuments(),
      Driver.countDocuments({ isOnline: true }),
      Driver.countDocuments({ isOnline: true, isAvailable: true }),
      User.countDocuments({ role: 'user' }),
      Order.find().sort({ createdAt: -1 }).limit(10)
        .populate('user', 'name email')
        .populate('driver', 'name vehiclePlate'),
      Order.aggregate([
        { $match: { status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$pricing.total' } } }
      ])
    ]);

    res.json({
      totalOrders, pendingOrders, activeOrders, deliveredOrders,
      cancelledOrders, totalDrivers, onlineDrivers, availableDrivers,
      totalUsers, totalRevenue: revenueAgg[0]?.total || 0, recentOrders
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getAllOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 30, search } = req.query;
    const query = {};
    if (status) query.status = status;
    if (search) query.$or = [{ orderNumber: { $regex: search, $options: 'i' } }];

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('user', 'name email phone avatar')
        .populate('driver', 'name phone vehicleType vehiclePlate isOnline isAvailable avatar')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit)),
      Order.countDocuments(query)
    ]);

    res.json({ orders, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email phone address')
      .populate('driver', 'name phone vehicleType vehiclePlate vehicleModel rating currentLocation isOnline isAvailable');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const assignDriver = async (req, res) => {
  try {
    const { driverId } = req.body;
    if (!driverId) return res.status(400).json({ message: 'driverId is required' });

    const [order, driver] = await Promise.all([
      Order.findById(req.params.id).populate('user', 'name email phone'),
      Driver.findById(driverId)
    ]);

    if (!order)  return res.status(404).json({ message: 'Order not found' });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });

    if (['delivered', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ message: `Cannot assign a driver to an order with status "${order.status}"` });
    }
    if (!driver.isActive) {
      return res.status(400).json({ message: 'This driver account is inactive' });
    }

    order.driver = driverId;
    order.status = 'assigned';
    order.trackingHistory.push({
      status: 'assigned',
      message: `Driver ${driver.name} has been assigned to your order.`,
      updatedBy: { role: 'admin', id: req.user._id, name: req.user.name }
    });
    await order.save();
    await Driver.findByIdAndUpdate(driverId, { isAvailable: false });
    await order.populate('driver', 'name phone vehicleType vehiclePlate vehicleModel avatar');

    // Notify driver
    await Notification.create({
      recipient: driverId, recipientModel: 'Driver', recipientRole: 'driver',
      title: '🎯 New Delivery Assignment',
      message: `You have been assigned order ${order.orderNumber}. Pickup from: ${order.pickup.address}, ${order.pickup.city}.`,
      type: 'driver_assigned', orderId: order._id, orderNumber: order.orderNumber
    });
    emitToDriver(req.io, driverId.toString(), 'order_assigned', {
      orderId: order._id, orderNumber: order.orderNumber,
      message: `You have been assigned order ${order.orderNumber}`, order
    });

    // Notify customer
    await Notification.create({
      recipient: order.user._id, recipientModel: 'User', recipientRole: 'user',
      title: '👤 Driver Assigned',
      message: `Driver ${driver.name} has been assigned to your order ${order.orderNumber}.`,
      type: 'order_assigned', orderId: order._id, orderNumber: order.orderNumber
    });
    emitToUser(req.io, order.user._id.toString(), 'order_update', {
      orderId: order._id, orderNumber: order.orderNumber, status: 'assigned',
      message: `Driver ${driver.name} has been assigned to your order!`,
      driver: { name: driver.name, phone: driver.phone, vehicleType: driver.vehicleType, vehiclePlate: driver.vehiclePlate }
    });

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const markDelivered = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('driver', 'name phone');

    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status === 'delivered') return res.status(400).json({ message: 'Order is already marked as delivered' });
    if (order.status === 'cancelled') return res.status(400).json({ message: 'Cannot deliver a cancelled order' });

    order.status = 'delivered';
    order.actualDelivery = new Date();
    order.trackingHistory.push({
      status: 'delivered',
      message: 'Delivery confirmed by admin.',
      updatedBy: { role: 'admin', id: req.user._id, name: req.user.name }
    });
    await order.save();

    if (order.driver) {
      await Driver.findByIdAndUpdate(order.driver._id, { $inc: { totalDeliveries: 1 }, isAvailable: true });
    }

    // Notify customer
    await Notification.create({
      recipient: order.user._id, recipientModel: 'User', recipientRole: 'user',
      title: '🎉 Order Delivered!',
      message: `Your order ${order.orderNumber} has been delivered successfully. Thank you for using SwiftMove!`,
      type: 'order_delivered', orderId: order._id, orderNumber: order.orderNumber
    });
    emitToUser(req.io, order.user._id.toString(), 'order_update', {
      orderId: order._id, orderNumber: order.orderNumber,
      status: 'delivered', message: '🎉 Your package has been delivered!'
    });

    // Notify driver
    if (order.driver) {
      await Notification.create({
        recipient: order.driver._id, recipientModel: 'Driver', recipientRole: 'driver',
        title: '✅ Delivery Confirmed',
        message: `Order ${order.orderNumber} has been marked as delivered. Great job!`,
        type: 'order_delivered', orderId: order._id, orderNumber: order.orderNumber
      });
      emitToDriver(req.io, order.driver._id.toString(), 'order_delivered', {
        orderId: order._id, orderNumber: order.orderNumber,
        message: `Order ${order.orderNumber} confirmed as delivered.`
      });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getAllDrivers = async (req, res) => {
  try {
    const { isOnline, isAvailable } = req.query;
    const query = {};
    if (isOnline !== undefined) query.isOnline = isOnline === 'true';
    if (isAvailable !== undefined) query.isAvailable = isAvailable === 'true';
    const drivers = await Driver.find(query).select('-password').sort({ isOnline: -1, createdAt: -1 });
    res.json(drivers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deactivateDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndUpdate(
      req.params.id, { isActive: false, isOnline: false, isAvailable: false },
      { new: true, select: '-password' }
    );
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    res.json({ message: 'Driver deactivated', driver });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const activateDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndUpdate(
      req.params.id, { isActive: true }, { new: true, select: '-password' }
    );
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    res.json({ message: 'Driver activated', driver });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getAdminNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ recipientRole: 'admin' })
        .sort({ createdAt: -1 }).limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit)),
      Notification.countDocuments({ recipientRole: 'admin', isRead: false })
    ]);
    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const markNotificationRead = async (req, res) => {
  try {
    const notif = await Notification.findByIdAndUpdate(req.params.id, { isRead: true }, { new: true });
    if (!notif) return res.status(404).json({ message: 'Notification not found' });
    res.json({ success: true, notification: notif });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const markAllRead = async (req, res) => {
  try {
    const result = await Notification.updateMany({ recipientRole: 'admin', isRead: false }, { isRead: true });
    res.json({ success: true, updated: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getRevenue = async (req, res) => {
  try {
    const { page = 1, limit = 20, from, to, driverId, search } = req.query;
    const query = { status: 'delivered' };

    if (from || to) {
      query.actualDelivery = {};
      if (from) query.actualDelivery.$gte = new Date(from);
      if (to)   query.actualDelivery.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }
    if (driverId) query.driver = driverId;
    if (search)   query.orderNumber = { $regex: search, $options: 'i' };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [orders, total, summaryAgg, byDriverAgg, byMonthAgg] = await Promise.all([
      Order.find(query)
        .populate('user', 'name email phone avatar')
        .populate('driver', 'name phone vehicleType vehiclePlate avatar')
        .sort({ actualDelivery: -1 }).limit(parseInt(limit)).skip(skip),
      Order.countDocuments(query),
      Order.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: '$pricing.total' }, vat: { $sum: '$pricing.vat' }, subtotal: { $sum: '$pricing.subtotal' } } }
      ]),
      Order.aggregate([
        { $match: { status: 'delivered', driver: { $ne: null } } },
        { $group: { _id: '$driver', total: { $sum: '$pricing.total' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } }, { $limit: 10 },
        { $lookup: { from: 'drivers', localField: '_id', foreignField: '_id', as: 'driver' } },
        { $unwind: '$driver' },
        { $project: { total: 1, count: 1, 'driver.name': 1, 'driver.avatar': 1, 'driver.vehicleType': 1 } }
      ]),
      Order.aggregate([
        { $match: { status: 'delivered', actualDelivery: { $gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) } } },
        { $group: { _id: { year: { $year: '$actualDelivery' }, month: { $month: '$actualDelivery' } }, total: { $sum: '$pricing.total' }, count: { $sum: 1 } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ])
    ]);

    res.json({
      orders, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)),
      summary: summaryAgg[0] || { total: 0, vat: 0, subtotal: 0 },
      byDriver: byDriverAgg, byMonth: byMonthAgg,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getDashboardStats, getAllOrders, getOrderById, assignDriver, markDelivered,
  getAllDrivers, deactivateDriver, activateDriver, getAllUsers,
  getAdminNotifications, markNotificationRead, markAllRead, getRevenue
};