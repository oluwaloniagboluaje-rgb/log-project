const express = require('express');
const router = express.Router();
const {
  registerUser, registerDriver,
  loginUser, loginDriver,
  getMe, updateProfile,
  requestOTP, verifyOTP,
  forgotPassword, resetPassword,
} = require('../controllers/Auth.controller');
const { protect } = require('../utility/Auth');
const { upload, uploadToCloudinary } = require('../utility/Cloudinary');

// single avatar upload middleware
const uploadAvatar = (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Avatar upload failed' });
    next();
  });
};

router.post('/register/user',   registerUser);
router.post('/register/driver', registerDriver);
router.post('/login/user',      loginUser);
router.post('/login/driver',    loginDriver);
router.get('/me',               protect, getMe);

// PATCH /api/auth/profile  — update name/phone/address/bio/avatar
router.patch('/profile', protect, uploadAvatar, uploadToCloudinary, updateProfile);

router.post('/request-otp',     requestOTP);
router.post('/verify-otp',      verifyOTP);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password',  resetPassword);

module.exports = router;