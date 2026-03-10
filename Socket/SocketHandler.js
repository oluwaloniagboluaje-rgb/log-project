const User = require('../models/User.model');
const Driver = require('../models/Driver.model');
const Order = require('../models/Order.model');

// Track connected sockets by role and ID
const connectedUsers = new Map();    // userId -> socketId
const connectedDrivers = new Map();  // driverId -> socketId
const connectedAdmins = new Set();   // socketIds of admins

function initSocket(io) {
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Authenticate and register socket
    socket.on('register', async ({ userId, role }) => {
      try {
        if (role === 'user') {
          connectedUsers.set(userId, socket.id);
          await User.findByIdAndUpdate(userId, { socketId: socket.id });
          socket.join(`user_${userId}`);
          console.log(`User ${userId} registered`);
        } else if (role === 'driver') {
          connectedDrivers.set(userId, socket.id);
          await Driver.findByIdAndUpdate(userId, { socketId: socket.id, isOnline: true });
          socket.join(`driver_${userId}`);
          // Notify admins driver came online
          io.to('admins').emit('driver_status_change', { driverId: userId, isOnline: true });
          console.log(`Driver ${userId} registered`);
        } else if (role === 'admin') {
          connectedAdmins.add(socket.id);
          socket.join('admins');
          console.log(`Admin registered`);
        }
      } catch (err) {
        console.error('Register error:', err);
      }
    });

    // Driver location update
    socket.on('driver_location_update', async ({ driverId, lat, lng, orderId }) => {
      try {
        // Update driver location in DB
        await Driver.findByIdAndUpdate(driverId, {
          'currentLocation.lat': lat,
          'currentLocation.lng': lng,
          'currentLocation.updatedAt': new Date()
        });

        const locationData = { driverId, lat, lng, timestamp: new Date() };

        // If driver has active order, update order's driverLocation and notify user
        if (orderId) {
          await Order.findByIdAndUpdate(orderId, {
            'driverLocation.lat': lat,
            'driverLocation.lng': lng,
            'driverLocation.updatedAt': new Date()
          });
          // Emit to the specific order room
          io.to(`order_${orderId}`).emit('driver_location', locationData);
        }

        // Always notify admins
        io.to('admins').emit('driver_location', locationData);
      } catch (err) {
        console.error('Location update error:', err);
      }
    });

    // User joins order room for tracking
    socket.on('track_order', ({ orderId }) => {
      socket.join(`order_${orderId}`);
    });

    socket.on('untrack_order', ({ orderId }) => {
      socket.leave(`order_${orderId}`);
    });

    // Driver confirms pickup
    socket.on('driver_picked_up', async ({ driverId, orderId }) => {
      try {
        const order = await Order.findById(orderId).populate('user driver');
        if (!order) return;

        order.status = 'picked_up';
        order.actualPickup = new Date();
        order.trackingHistory.push({
          status: 'picked_up',
          message: 'Package has been picked up by the driver.',
          timestamp: new Date(),
          updatedBy: { role: 'driver', id: driverId, name: order.driver?.name }
        });
        await order.save();

        // Notify user
        io.to(`user_${order.user._id}`).emit('order_update', {
          orderId, orderNumber: order.orderNumber, status: 'picked_up',
          message: '📦 Your package has been picked up!'
        });

        // Notify admins
        io.to('admins').emit('order_update', {
          orderId, orderNumber: order.orderNumber, status: 'picked_up',
          driverName: order.driver?.name, message: 'Driver picked up package'
        });
      } catch (err) {
        console.error('Picked up error:', err);
      }
    });

    // Driver marks in transit
    socket.on('driver_in_transit', async ({ driverId, orderId }) => {
      try {
        const order = await Order.findById(orderId).populate('user driver');
        if (!order) return;

        order.status = 'in_transit';
        order.trackingHistory.push({
          status: 'in_transit',
          message: 'Package is on its way to the delivery address.',
          timestamp: new Date(),
          updatedBy: { role: 'driver', id: driverId, name: order.driver?.name }
        });
        await order.save();

        io.to(`user_${order.user._id}`).emit('order_update', {
          orderId, orderNumber: order.orderNumber, status: 'in_transit',
          message: '🚚 Your package is on its way!'
        });

        io.to('admins').emit('order_update', {
          orderId, orderNumber: order.orderNumber, status: 'in_transit',
          driverName: order.driver?.name
        });
      } catch (err) {
        console.error('In transit error:', err);
      }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${socket.id}`);

      // Find and update driver status
      for (const [driverId, sid] of connectedDrivers.entries()) {
        if (sid === socket.id) {
          connectedDrivers.delete(driverId);
          await Driver.findByIdAndUpdate(driverId, { isOnline: false, socketId: null });
          io.to('admins').emit('driver_status_change', { driverId, isOnline: false });
          break;
        }
      }

      // Clean up user
      for (const [userId, sid] of connectedUsers.entries()) {
        if (sid === socket.id) {
          connectedUsers.delete(userId);
          await User.findByIdAndUpdate(userId, { socketId: null });
          break;
        }
      }

      connectedAdmins.delete(socket.id);
    });
  });
}

// Helper to emit to a specific user
function emitToUser(io, userId, event, data) {
  io.to(`user_${userId}`).emit(event, data);
}

// Helper to emit to a specific driver
function emitToDriver(io, driverId, event, data) {
  io.to(`driver_${driverId}`).emit(event, data);
}

// Helper to emit to all admins
function emitToAdmins(io, event, data) {
  io.to('admins').emit(event, data);
}

module.exports = { initSocket, emitToUser, emitToDriver, emitToAdmins };