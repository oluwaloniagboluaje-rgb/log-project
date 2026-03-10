const Driver = require('../models/Driver.model');
const Order = require('../models/Order.model');

// @desc    Get logged-in driver's profile
// @route   GET /api/drivers/profile
// @access  Private (driver)
const getProfile = async (req, res) => {
  try {
    const driver = await Driver.findById(req.user._id).select('-password');
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    res.json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc    Update driver profile details
// @route   PUT /api/drivers/profile
// @access  Private (driver)
const updateProfile = async (req, res) => {
  try {
    const allowed = ['name', 'phone', 'vehicleModel', 'vehiclePlate', 'vehicleType'];
    const updates = {};

    for (const field of allowed) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    // Prevent email/password updates through this route
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided to update' });
    }

    const driver = await Driver.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true, select: '-password' }
    );

    if (!driver) return res.status(404).json({ message: 'Driver not found' });

    res.json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc    Toggle driver availability
// @route   PATCH /api/drivers/availability
// @access  Private (driver)
const updateAvailability = async (req, res) => {
  try {
    const { isAvailable } = req.body;

    if (typeof isAvailable !== 'boolean') {
      return res.status(400).json({ message: 'isAvailable must be a boolean' });
    }

    // Cannot go unavailable while having an active delivery
    if (!isAvailable) {
      const activeOrder = await Order.findOne({
        driver: req.user._id,
        status: { $in: ['assigned', 'picked_up', 'in_transit', 'out_for_delivery'] }
      });

      if (activeOrder) {
        return res.status(400).json({
          message: `You have an active delivery (${activeOrder.orderNumber}). Complete it before going unavailable.`
        });
      }
    }

    const driver = await Driver.findByIdAndUpdate(
      req.user._id,
      { isAvailable },
      { new: true, select: '-password' }
    );

    res.json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc    Update driver's current GPS location
// @route   PATCH /api/drivers/location
// @access  Private (driver)
const updateLocation = async (req, res) => {
  try {
    const { lat, lng, address } = req.body;

    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ message: 'lat and lng are required' });
    }

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ message: 'lat and lng must be numbers' });
    }

    const driver = await Driver.findByIdAndUpdate(
      req.user._id,
      {
        'currentLocation.lat': lat,
        'currentLocation.lng': lng,
        'currentLocation.address': address || null,
        'currentLocation.updatedAt': new Date()
      },
      { new: true, select: '-password' }
    );

    // Broadcast to admin room via socket
    if (req.io) {
      req.io.to('admins').emit('driver_location', {
        driverId: req.user._id,
        driverName: req.user.name,
        lat,
        lng,
        timestamp: new Date()
      });
    }

    res.json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc    Get all drivers (admin)
// @route   GET /api/drivers/all
// @access  Private (admin)
const getAllDrivers = async (req, res) => {
  try {
    const drivers = await Driver.find({})
      .select('-password')
      .sort({ createdAt: -1 });

    res.json(drivers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc    Get driver stats summary for dashboard
// @route   GET /api/drivers/stats
// @access  Private (driver)
const getDriverStats = async (req, res) => {
  try {
    const driverId = req.user._id;

    const [
      totalDeliveries,
      activeOrders,
      totalEarningsAgg
    ] = await Promise.all([
      Order.countDocuments({ driver: driverId, status: 'delivered' }),
      Order.countDocuments({ driver: driverId, status: { $in: ['assigned', 'picked_up', 'in_transit', 'out_for_delivery'] } }),
      Order.aggregate([
        { $match: { driver: driverId, status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$pricing.total' } } }
      ])
    ]);

    const totalRevenue = totalEarningsAgg[0]?.total || 0;

    res.json({ totalDeliveries, activeOrders, totalRevenue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  updateAvailability,
  updateLocation,
  getAllDrivers,
  getDriverStats
};