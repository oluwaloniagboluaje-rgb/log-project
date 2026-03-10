const jwt = require('jsonwebtoken');
const User = require('../models/User.model');
const Driver = require('../models/Driver.model');

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Token invalid or expired' });
    }

    let currentUser = null;

    // Determine role from token; default to 'user' if not set
    const role = decoded.role || 'user';

    if (role === 'driver') {
      currentUser = await Driver.findById(decoded.id).select('-password');
    } else {
      currentUser = await User.findById(decoded.id).select('-password');
    }

    if (!currentUser) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = currentUser;
    req.userRole = role;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(401).json({ message: 'Token invalid or expired' });
  }
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({ message: `Access denied. Required role: ${roles.join(' or ')}` });
    }
    next();
  };
};

module.exports = { protect, requireRole };