const express = require('express');
const router = express.Router();
const Order = require('../models/Order.model');
const Notification = require('../models/Notification.model');
const User = require('../models/User.model');
const { protect, requireRole } = require('../utility/Auth');
const { calculatePrice } = require('../utility/Pricing');
const { emitToAdmins } = require('../Socket/SocketHandler');
const { placeOrder, confirmDelivery } = require('../controllers/Order.controller');
const { upload, uploadToCloudinary } = require('../utility/Cloudinary');

const uploadImages = (req, res, next) => {
  upload.array('images', 2)(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Image upload failed' });
    next();
  });
};

// --------------------
// Calculate price (before placing order)
// --------------------
router.post('/calculate-price', protect, async (req, res) => {
  try {
    const { weightKg, pickupPostcode, deliveryPostcode, fragile } = req.body;
    if (!weightKg || !pickupPostcode || !deliveryPostcode) {
      return res.status(400).json({ message: 'weightKg, pickupPostcode, and deliveryPostcode are required' });
    }

    const pricing = calculatePrice({
      weightKg: parseFloat(weightKg),
      pickupPostcode,
      deliveryPostcode,
      fragile: !!fragile
    });

    res.json(pricing);
  } catch (err) {
    console.error('Error calculating price:', err);
    res.status(500).json({ message: err.message });
  }
});

// --------------------
// Place order (user)
// --------------------
router.post('/placeorder', protect, requireRole('user'), uploadImages, uploadToCloudinary, placeOrder);

// --------------------
// Get logged-in user's orders
// --------------------
router.get('/my-orders', protect, requireRole('user'), async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = { user: req.user._id };
    if (status) query.status = status;

    const orders = await Order.find(query)
      .populate('driver', 'name phone vehicleType vehiclePlate vehicleModel rating')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Order.countDocuments(query);
    res.json({ orders, total, page: parseInt(page) });
  } catch (err) {
    console.error('Error fetching user orders:', err);
    res.status(500).json({ message: err.message });
  }
});

router.get('/driver/assigned', protect, requireRole('driver'), async (req, res) => {
  try {
    const orders = await Order.find({ driver: req.user._id, status: { $nin: ['delivered', 'cancelled'] } })
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error('Error fetching assigned orders:', err);
    res.status(500).json({ message: err.message });
  }
});

// --------------------
// Driver history — paginated, returns total & totalDelivered for stats
// --------------------
router.get('/driver/history', protect, requireRole('driver'), async (req, res) => {
  try {
    const { page = 1, limit = 5 } = req.query;
    const [orders, total, totalDelivered] = await Promise.all([
      Order.find({ driver: req.user._id })
        .populate('user', 'name email phone')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit)),
      Order.countDocuments({ driver: req.user._id }),
      Order.countDocuments({ driver: req.user._id, status: 'delivered' }),
    ]);
    res.json({ orders, total, totalDelivered, page: parseInt(page) });
  } catch (err) {
    console.error('Error fetching driver history:', err);
    res.status(500).json({ message: err.message });
  }
});

// --------------------
// Public tracking (no login required)
// --------------------
router.get('/track/:orderNumber', async (req, res) => {
  try {
    const order = await Order.findOne({
      orderNumber: req.params.orderNumber
    })
      .populate('driver', 'name phone vehicleType vehiclePlate vehicleModel rating currentLocation isOnline');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json(order);
  } catch (err) {
    console.error('Tracking error:', err);
    res.status(500).json({ message: err.message });
  }
});


// --------------------
// Get single order (user, driver, or admin)
// --------------------
router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('driver', 'name phone vehicleType vehiclePlate vehicleModel rating currentLocation isOnline');

    if (!order) return res.status(404).json({ message: 'Order not found' });

    // Access control
    if (req.userRole === 'user' && order.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (req.userRole === 'driver' && order.driver?._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(order);
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ message: err.message });
  }
});

// --------------------
// Cancel order (user)
// --------------------
router.patch('/:id/cancel', protect, requireRole('user'), async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (['picked_up', 'in_transit', 'out_for_delivery', 'delivered'].includes(order.status)) {
      return res.status(400).json({ message: 'Cannot cancel order that is already in progress' });
    }

    order.status = 'cancelled';
    order.cancelReason = req.body.reason || 'Cancelled by user';
    order.trackingHistory.push({
      status: 'cancelled',
      message: `Order cancelled by user. Reason: ${order.cancelReason}`,
      updatedBy: { role: 'user', id: req.user._id, name: req.user.name }
    });
    await order.save();

    emitToAdmins(req.io, 'order_update', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      status: 'cancelled',
      message: `Order ${order.orderNumber} cancelled by user`
    });

    res.json(order);
  } catch (err) {
    console.error('Error cancelling order:', err);
    res.status(500).json({ message: err.message });
  }
});

// --------------------
// Driver routes
// --------------------

router.patch('/:id/driver-update', protect, requireRole('driver'), async (req, res) => {
  try {
    const { status, locationName } = req.body;
    const allowedStatuses = ['picked_up', 'in_transit', 'out_for_delivery'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status update' });
    }

    const order = await Order.findOne({ _id: req.params.id, driver: req.user._id });
    if (!order) return res.status(404).json({ message: 'Order not found or not assigned to you' });

    const messages = {
      picked_up: 'Package has been picked up by the driver.',
      in_transit: 'Package is on its way to the delivery address.',
      out_for_delivery: 'Package is out for delivery – arriving soon!'
    };

    order.status = status;
    if (status === 'picked_up') order.actualPickup = new Date();

    order.trackingHistory.push({
      status,
      message: messages[status],
      locationName,
      updatedBy: { role: 'driver', id: req.user._id, name: req.user.name }
    });
    await order.save();
    await order.populate('user', 'name email phone');

    // Notify user
    req.io?.to(`user_${order.user._id}`).emit('order_update', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      status,
      message: messages[status]
    });

    // Save notification for user
    await Notification.create({
      recipient: order.user._id,
      recipientModel: 'User',
      recipientRole: 'user',
      title: `Order ${status.replace('_', ' ')}`,
      message: messages[status],
      type: `order_${status}`,
      orderId: order._id,
      orderNumber: order.orderNumber
    });

    // Notify admins
    emitToAdmins(req.io, 'order_update', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      status,
      driverName: req.user.name
    });

    res.json(order);
  } catch (err) {
    console.error('Error updating order by driver:', err);
    res.status(500).json({ message: err.message });
  }
});

// --------------------
// Confirm delivery (user)
// --------------------
router.patch('/:id/confirm-delivery', protect, requireRole('user'), confirmDelivery);

// --------------------
// Notifications
// --------------------
router.get('/notifications/mine', protect, async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(notifications);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ message: err.message });
  }
});

router.patch('/notifications/:id/read', protect, async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    console.error('Error marking notification read:', err);
    res.status(500).json({ message: err.message });
  }
});

router.patch('/notifications/read-all', protect, async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    console.error('Error marking all notifications read:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;