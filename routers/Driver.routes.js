const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver.model');
const Order = require('../models/Order.model');
const { protect, requireRole } = require('../utility/Auth');

// Get driver profile
router.get('/profile', protect, requireRole('driver'), async (req, res) => {
  try {
    const driver = await Driver.findById(req.user._id).select('-password');
    res.json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update driver profile
router.put('/profile', protect, requireRole('driver'), async (req, res) => {
  try {
    const { name, phone, vehicleModel, vehiclePlate, vehicleType } = req.body;
    const driver = await Driver.findByIdAndUpdate(
      req.user._id,
      { name, phone, vehicleModel, vehiclePlate, vehicleType },
      { new: true, select: '-password' }
    );
    res.json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update driver availability
router.patch('/availability', protect, requireRole('driver'), async (req, res) => {
  try {
    const { isAvailable } = req.body;
    const driver = await Driver.findByIdAndUpdate(
      req.user._id,
      { isAvailable },
      { new: true, select: '-password' }
    );
    res.json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update driver location
router.patch('/location', protect, requireRole('driver'), async (req, res) => {
  try {
    const { lat, lng, address } = req.body;
    const driver = await Driver.findByIdAndUpdate(
      req.user._id,
      {
        'currentLocation.lat': lat,
        'currentLocation.lng': lng,
        'currentLocation.address': address,
        'currentLocation.updatedAt': new Date()
      },
      { new: true, select: '-password' }
    );

    // Also emit via socket if req.io available
    if (req.io) {
      req.io.to('admins').emit('driver_location', { driverId: req.user._id, lat, lng });
    }

    res.json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all available drivers (admin use)
router.get('/all', protect, requireRole('admin'), async (req, res) => {
  try {
    const drivers = await Driver.find({}).select('-password').sort({ createdAt: -1 });
    res.json(drivers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;