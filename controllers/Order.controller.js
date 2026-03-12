const Order = require('../models/Order.model');
const User = require('../models/User.model');
const Driver = require('../models/Driver.model');
const Notification = require('../models/Notification.model');
const { calculatePrice } = require('../utility/Pricing');
const { mailSender, sendMail } = require('../middleware/mailer');

// Safe socket emitters — silent on Vercel where req.io is undefined
const emitToAdmins = (io, event, data) => {
  try { if (io) io.to('admins').emit(event, data); } catch {}
};
const emitToUser = (io, userId, event, data) => {
  try { if (io) io.to(`user_${userId}`).emit(event, data); } catch {}
};
const emitToDriver = (io, driverId, event, data) => {
  try { if (io) io.to(`driver_${driverId}`).emit(event, data); } catch {}
};

const statusMessages = {
  picked_up: 'Package has been picked up by the driver.',
  in_transit: 'Package is on its way to the delivery address.',
  out_for_delivery: 'Package is out for delivery – arriving soon!'
};

const notifyAdmins = async (title, message, type, orderId, orderNumber) => {
  try {
    const admins = await User.find({ role: 'admin' });
    await Promise.all(admins.map(admin => Notification.create({
      recipient: admin._id, recipientModel: 'User', recipientRole: 'admin',
      title, message, type, orderId, orderNumber
    })));
  } catch (err) { console.error('notifyAdmins error:', err.message); }
};

// @route POST /api/orders/calculate-price
const calculateOrderPrice = async (req, res) => {
  try {
    const { weightKg, pickupPostcode, deliveryPostcode, fragile } = req.body;
    if (!weightKg || !pickupPostcode || !deliveryPostcode)
      return res.status(400).json({ message: 'weightKg, pickupPostcode, and deliveryPostcode are required' });
    if (isNaN(parseFloat(weightKg)) || parseFloat(weightKg) <= 0)
      return res.status(400).json({ message: 'weightKg must be a positive number' });
    const pricing = calculatePrice({ weightKg: parseFloat(weightKg), pickupPostcode, deliveryPostcode, fragile: !!fragile });
    res.json(pricing);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route POST /api/orders/placeorder
const placeOrder = async (req, res) => {
  try {
    const { pickup, delivery, package: pkg, notes } = req.body;
    if (!pickup || !delivery || !pkg)
      return res.status(400).json({ message: 'pickup, delivery and package are required' });
    for (const field of ['contactName', 'contactPhone', 'address', 'city', 'postcode']) {
      if (!pickup[field]) return res.status(400).json({ message: `pickup.${field} is required` });
      if (!delivery[field]) return res.status(400).json({ message: `delivery.${field} is required` });
    }
    if (!pkg.description || !pkg.weightKg)
      return res.status(400).json({ message: 'package.description and package.weightKg are required' });

    let pricing;
    try {
      pricing = calculatePrice({ weightKg: parseFloat(pkg.weightKg), pickupPostcode: pickup.postcode, deliveryPostcode: delivery.postcode, fragile: !!pkg.fragile });
    } catch {
      const w = parseFloat(pkg.weightKg);
      const subtotal = parseFloat((8.99 + w * 1.5 + (pkg.fragile ? 2.5 : 0)).toFixed(2));
      const vat = parseFloat((subtotal * 0.2).toFixed(2));
      pricing = { baseRate: 8.99, weightCharge: parseFloat((w * 1.5).toFixed(2)), distanceCharge: 0, fragileCharge: pkg.fragile ? 2.5 : 0, subtotal, vat, total: parseFloat((subtotal + vat).toFixed(2)), distanceKm: 0, currency: 'GBP' };
    }

    const validCategories = ['documents', 'electronics', 'clothing', 'food', 'furniture', 'machinery', 'other'];
    const category = validCategories.includes((pkg.category || '').toLowerCase()) ? pkg.category.toLowerCase() : 'other';
    const images = (req.files || []).map(file => ({ url: file.path, publicId: file.filename }));

    const order = await Order.create({
      user: req.user._id, pickup, delivery,
      package: { description: pkg.description, weightKg: parseFloat(pkg.weightKg), quantity: parseInt(pkg.quantity) || 1, fragile: !!pkg.fragile, category, images },
      pricing, notes,
      trackingHistory: [{ status: 'pending', message: 'Order placed and awaiting confirmation.', updatedBy: { role: 'user', id: req.user._id, name: req.user.name } }]
    });
    await order.populate('user', 'name email phone');

    mailSender('orderPlacedMail.ejs', {
      firstName: req.user.name, orderNumber: order.orderNumber,
      pickup: `${pickup.address}, ${pickup.city}, ${pickup.postcode}`,
      delivery: `${delivery.address}, ${delivery.city}, ${delivery.postcode}`,
      description: pkg.description, weightKg: pkg.weightKg, total: pricing.total,
    }).then(html => sendMail(req.user.email, `Order Confirmed — ${order.orderNumber}`, html))
      .catch(err => console.error('orderPlaced mail failed:', err.message));

    notifyAdmins('New Order Placed 📦', `${req.user.name} placed order ${order.orderNumber} — ${pickup.city} → ${delivery.city}`, 'order_placed', order._id, order.orderNumber);
    emitToAdmins(req.io, 'new_order', { orderId: order._id, orderNumber: order.orderNumber, userName: req.user.name, order });

    res.status(201).json(order);
  } catch (err) {
    console.error('placeOrder error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// @route GET /api/orders/my-orders
const getMyOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = { user: req.user._id };
    if (status) query.status = status;
    const [orders, total] = await Promise.all([
      Order.find(query).populate('driver', 'name phone vehicleType vehiclePlate vehicleModel rating isOnline avatar').sort({ createdAt: -1 }).limit(parseInt(limit)).skip((parseInt(page) - 1) * parseInt(limit)),
      Order.countDocuments(query)
    ]);
    res.json({ orders, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route GET /api/orders/:id
const getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('driver', 'name phone vehicleType vehiclePlate vehicleModel rating currentLocation isOnline avatar');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (req.userRole === 'user' && order.user._id.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Access denied' });
    if (req.userRole === 'driver' && (!order.driver || order.driver._id.toString() !== req.user._id.toString()))
      return res.status(403).json({ message: 'Access denied' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route PATCH /api/orders/:id/cancel
const cancelOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (['picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled'].includes(order.status))
      return res.status(400).json({ message: `Cannot cancel an order with status "${order.status}".` });
    order.status = 'cancelled';
    order.cancelReason = req.body.reason || 'Cancelled by user';
    order.trackingHistory.push({ status: 'cancelled', message: `Order cancelled. Reason: ${order.cancelReason}`, updatedBy: { role: 'user', id: req.user._id, name: req.user.name } });
    await order.save();
    emitToAdmins(req.io, 'order_update', { orderId: order._id, orderNumber: order.orderNumber, status: 'cancelled' });
    notifyAdmins('Order Cancelled ❌', `${req.user.name} cancelled order ${order.orderNumber}.`, 'order_cancelled', order._id, order.orderNumber);
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route GET /api/orders/driver/assigned
const getDriverAssigned = async (req, res) => {
  try {
    const orders = await Order.find({ driver: req.user._id, status: { $nin: ['delivered', 'cancelled'] } }).populate('user', 'name email phone').sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route GET /api/orders/driver/history
const getDriverHistory = async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const [orders, total, totalDelivered] = await Promise.all([
      Order.find({ driver: req.user._id }).populate('user', 'name email phone').sort({ createdAt: -1 }).limit(parseInt(limit)).skip((parseInt(page) - 1) * parseInt(limit)),
      Order.countDocuments({ driver: req.user._id }),
      Order.countDocuments({ driver: req.user._id, status: 'delivered' })
    ]);
    res.json({ orders, total, totalDelivered, page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @route PATCH /api/orders/:id/driver-update
const driverUpdateStatus = async (req, res) => {
  try {
    const { status, locationName } = req.body;
    const allowedStatuses = ['picked_up', 'in_transit', 'out_for_delivery'];
    if (!allowedStatuses.includes(status))
      return res.status(400).json({ message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}` });
    const order = await Order.findOne({ _id: req.params.id, driver: req.user._id });
    if (!order) return res.status(404).json({ message: 'Order not found or not assigned to you' });
    const progression = { picked_up: 'assigned', in_transit: 'picked_up', out_for_delivery: 'in_transit' };
    if (order.status !== progression[status])
      return res.status(400).json({ message: `Cannot mark as "${status}" — current status is "${order.status}"` });
    order.status = status;
    if (status === 'picked_up') order.actualPickup = new Date();
    order.trackingHistory.push({ status, message: statusMessages[status], locationName: locationName || null, updatedBy: { role: 'driver', id: req.user._id, name: req.user.name } });
    await order.save();
    await order.populate('user', 'name email phone');
    emitToUser(req.io, order.user._id.toString(), 'order_update', { orderId: order._id, orderNumber: order.orderNumber, status, message: statusMessages[status] });
    emitToAdmins(req.io, 'order_update', { orderId: order._id, orderNumber: order.orderNumber, status, driverName: req.user.name });
    Notification.create({ recipient: order.user._id, recipientModel: 'User', recipientRole: 'user', title: `Order ${status.replace(/_/g, ' ')}`, message: statusMessages[status], type: `order_${status}`, orderId: order._id, orderNumber: order.orderNumber }).catch(console.error);
    res.json(order);
  } catch (err) {
    console.error('driverUpdateStatus error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// @route PATCH /api/orders/:id/assign-driver (admin only)
const assignDriver = async (req, res) => {
  try {
    const { driverId } = req.body;
    if (!driverId) return res.status(400).json({ message: 'driverId is required' });
    const order = await Order.findById(req.params.id).populate('user', 'name email phone');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const driver = await Driver.findById(driverId);
    if (!driver) return res.status(404).json({ message: 'Driver not found' });

    order.driver = driverId;
    order.status = 'assigned';
    order.trackingHistory.push({ status: 'assigned', message: `Driver ${driver.name} has been assigned to your order.`, updatedBy: { role: 'admin', id: req.user._id, name: req.user.name } });
    await order.save();
    await order.populate('driver', 'name phone vehicleType vehiclePlate vehicleModel rating avatar');

    if (order.user?.email) {
      mailSender('driverAssignedMail.ejs', {
        firstName: order.user.name, orderNumber: order.orderNumber,
        driverName: driver.name, driverPhone: driver.phone,
        vehicleType: driver.vehicleType, vehiclePlate: driver.vehiclePlate,
        vehicleModel: driver.vehicleModel || '', driverAvatar: driver.avatar || null,
      }).then(html => sendMail(order.user.email, `Driver Assigned — ${order.orderNumber}`, html))
        .catch(err => console.error('driverAssigned mail failed:', err.message));
    }

    Notification.create({ recipient: driverId, recipientModel: 'Driver', recipientRole: 'driver', title: 'New Delivery Assigned 🚛', message: `You have been assigned order ${order.orderNumber} — ${order.pickup.city} → ${order.delivery.city}`, type: 'order_assigned', orderId: order._id, orderNumber: order.orderNumber }).catch(console.error);
    emitToDriver(req.io, driverId.toString(), 'order_assigned', { orderId: order._id, orderNumber: order.orderNumber });
    emitToUser(req.io, order.user._id.toString(), 'order_update', { orderId: order._id, orderNumber: order.orderNumber, status: 'assigned' });

    res.json(order);
  } catch (err) {
    console.error('assignDriver error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// @route PATCH /api/orders/:id/confirm-delivery
const confirmDelivery = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id }).populate('driver', 'name phone');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'out_for_delivery')
      return res.status(400).json({ message: `Cannot confirm delivery — current status is "${order.status}".` });
    order.status = 'delivered';
    order.actualDelivery = new Date();
    order.trackingHistory.push({ status: 'delivered', message: 'Delivery confirmed by the customer.', updatedBy: { role: 'user', id: req.user._id, name: req.user.name } });
    await order.save();
    if (order.driver) Driver.findByIdAndUpdate(order.driver._id, { $inc: { totalDeliveries: 1 }, isAvailable: true }).catch(console.error);
    notifyAdmins('✅ Delivery Confirmed', `${req.user.name} confirmed delivery of order ${order.orderNumber}`, 'order_delivered', order._id, order.orderNumber);
    emitToAdmins(req.io, 'order_update', { orderId: order._id, orderNumber: order.orderNumber, status: 'delivered' });
    if (order.driver) {
      emitToDriver(req.io, order.driver._id.toString(), 'order_delivered', { orderId: order._id, orderNumber: order.orderNumber });
      Notification.create({ recipient: order.driver._id, recipientModel: 'Driver', recipientRole: 'driver', title: '✅ Delivery Confirmed', message: `${req.user.name} confirmed delivery of order ${order.orderNumber}. Great job!`, type: 'order_delivered', orderId: order._id, orderNumber: order.orderNumber }).catch(console.error);
    }
    res.json(order);
  } catch (err) {
    console.error('confirmDelivery error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// @route GET /api/orders/notifications/mine
const getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user._id }).sort({ createdAt: -1 }).limit(50);
    const unreadCount = await Notification.countDocuments({ recipient: req.user._id, isRead: false });
    res.json({ notifications, unreadCount });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// @route PATCH /api/orders/notifications/:id/read
const markNotificationRead = async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate({ _id: req.params.id, recipient: req.user._id }, { isRead: true }, { new: true });
    if (!notif) return res.status(404).json({ message: 'Notification not found' });
    res.json({ success: true, notification: notif });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// @route PATCH /api/orders/notifications/read-all
const markAllNotificationsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true });
    res.json({ success: true, updated: result.modifiedCount });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = {
  calculateOrderPrice, placeOrder, getMyOrders, getOrder, cancelOrder,
  getDriverAssigned, getDriverHistory, driverUpdateStatus, assignDriver,
  confirmDelivery, getMyNotifications, markNotificationRead, markAllNotificationsRead
};