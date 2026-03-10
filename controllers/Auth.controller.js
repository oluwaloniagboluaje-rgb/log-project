const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const otpgen = require('otp-generator');

const User = require('../models/User.model');
const Driver = require('../models/Driver.model');
const OTPModel = require('../models/OTP.model');

const { mailSender, sendMail } = require('../middleware/mailer');

const SALT_ROUNDS = 12;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const findAccount = async (email) => {
  const user = await User.findOne({ email });
  if (user) return { account: user, type: 'user' };
  const driver = await Driver.findOne({ email });
  if (driver) return { account: driver, type: 'driver' };
  return { account: null, type: null };
};

// ──────────────────────────────────────────────
// Register / Login
// ──────────────────────────────────────────────

const registerUser = async (req, res) => {
  try {
    const { name, email, phone, password, address } = req.body;
    if (!name || !email || !phone || !password)
      return res.status(400).json({ message: 'Name, email, phone and password are required' });
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' });
    const user = await User.create({ name, email, phone, password, address });
    if (req.io) req.io.emit('new-user', { email: user.email });
    const token = generateToken(user._id, user.role);
    mailSender('welcomeMail.ejs', { firstName: name })
      .then(html => sendMail(email, 'Welcome to SwiftRoute! 🚛', html))
      .then(() => console.log('✅ Welcome mail sent to', email))
      .catch(err => console.error('❌ Welcome mail failed:', err.message));
    res.status(201).json({ token, user, role: user.role });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const registerDriver = async (req, res) => {
  try {
    const { name, email, phone, password, vehicleType, vehiclePlate, vehicleModel } = req.body;
    if (!name || !email || !phone || !password || !vehiclePlate)
      return res.status(400).json({ message: 'Name, email, phone, password and vehicle plate are required' });
    const existing = await Driver.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' });
    const driver = await Driver.create({ name, email, phone, password, vehicleType, vehiclePlate, vehicleModel });
    if (req.io) req.io.emit('new-driver', { email: driver.email });
    const token = generateToken(driver._id, 'driver');
    mailSender('welcomeMail.ejs', { firstName: name })
      .then(html => sendMail(email, 'Welcome to SwiftRoute! 🚛', html))
      .then(() => console.log('✅ Welcome mail sent to', email))
      .catch(err => console.error('❌ Welcome mail failed:', err.message));
    res.status(201).json({ token, user: driver, role: 'driver' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ message: 'Invalid email or password' });
    if (!user.isActive)
      return res.status(403).json({ message: 'Your account has been deactivated. Contact support.' });
    const token = generateToken(user._id, user.role);
    res.json({ token, user, role: user.role });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const loginDriver = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });
    const driver = await Driver.findOne({ email });
    if (!driver || !(await driver.comparePassword(password)))
      return res.status(401).json({ message: 'Invalid email or password' });
    if (!driver.isActive)
      return res.status(403).json({ message: 'Your account has been deactivated. Contact support.' });
    const token = generateToken(driver._id, 'driver');
    res.json({ token, user: driver, role: 'driver' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getMe = async (req, res) => {
  try {
    res.json({ user: req.user, role: req.userRole });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ──────────────────────────────────────────────
// Profile update
// ──────────────────────────────────────────────

const updateProfile = async (req, res) => {
  try {
    const { name, phone, address, bio } = req.body;
    const Model = req.userRole === 'driver' ? Driver : User;
    const updates = {};
    if (name)              updates.name    = name;
    if (phone)             updates.phone   = phone;
    if (address)           updates.address = address;
    if (bio !== undefined) updates.bio     = bio;
    if (req.file) {
      updates.avatar         = req.file.path;
      updates.avatarPublicId = req.file.filename;
    }
    const account = await Model.findByIdAndUpdate(req.user._id, updates, { new: true });
    res.json({ user: account });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ──────────────────────────────────────────────
// OTP
// ──────────────────────────────────────────────

const requestOTP = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });
  try {
    const { account } = await findAccount(email);
    if (!account)
      return res.status(404).json({ message: 'No account found with that email' });
    const otp = otpgen.generate(4, { upperCaseAlphabets: false, specialChars: false, lowerCaseAlphabets: false, digits: true });
    await OTPModel.deleteMany({ email });
    await OTPModel.create({ email, otp });
    const html = await mailSender('otpMail.ejs', { otp });
    await sendMail(email, 'Your OTP Code', html);
    res.status(200).json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('requestOTP error:', error);
    res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
  }
};

const verifyOTP = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });
  try {
    const record = await OTPModel.findOne({ email }).sort({ createdAt: -1 });
    if (!record)
      return res.status(400).json({ message: 'OTP has expired or does not exist. Please request a new one.' });
    if (record.otp !== String(otp))
      return res.status(400).json({ message: 'Invalid OTP. Please try again.' });
    await OTPModel.deleteMany({ email });
    res.status(200).json({ message: 'OTP verified successfully' });
  } catch (error) {
    console.error('verifyOTP error:', error);
    res.status(500).json({ message: 'OTP verification failed. Please try again.' });
  }
};

// ──────────────────────────────────────────────
// Forgot / Reset Password
// ──────────────────────────────────────────────

const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });
  try {
    const { account } = await findAccount(email);
    if (!account)
      return res.status(200).json({ message: 'If that email is registered, an OTP has been sent.' });
    const otp = otpgen.generate(4, { upperCaseAlphabets: false, specialChars: false, lowerCaseAlphabets: false, digits: true });
    await OTPModel.deleteMany({ email });
    await OTPModel.create({ email, otp });
    const html = await mailSender('otpMail.ejs', { otp });
    await sendMail(email, 'Password Reset OTP', html);
    res.status(200).json({ message: 'If that email is registered, an OTP has been sent.' });
  } catch (error) {
    console.error('forgotPassword error:', error);
    res.status(500).json({ message: 'Failed to process request. Please try again.' });
  }
};

const resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword)
    return res.status(400).json({ message: 'Email, OTP, and new password are required' });
  if (newPassword.length < 6)
    return res.status(400).json({ message: 'Password must be at least 6 characters' });

  try {
    // 1. Verify OTP
    const record = await OTPModel.findOne({ email }).sort({ createdAt: -1 });
    if (!record)
      return res.status(400).json({ message: 'OTP has expired or does not exist. Please request a new one.' });
    if (record.otp !== String(otp))
      return res.status(400).json({ message: 'Invalid OTP. Please try again.' });

    // 2. Find account
    const { account, type } = await findAccount(email);
    if (!account) return res.status(404).json({ message: 'Account not found' });

    // 3. Hash password manually then update via findByIdAndUpdate
    //    — this bypasses the pre-save hook entirely, preventing double-hashing
    // const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    // const Model = type === 'driver' ? Driver : User;
    // await Model.findByIdAndUpdate(account._id, { password: hashedPassword });

    // 4. Clean up OTP
    await OTPModel.deleteMany({ email });

    // 5. Send password changed confirmation email
    console.log('🔵 Sending password changed email to:', email);
    mailSender('passwordChangedMail.ejs', { firstName: account.name })
      .then(html => sendMail(email, 'Your SwiftRoute password was changed', html))
      .then(() => console.log('✅ Password changed mail sent to', email))
      .catch(err => console.error('❌ Password changed mail failed:', err.message));

    // 6. Return fresh token
    const token = generateToken(account._id, type === 'driver' ? 'driver' : account.role);
    res.status(200).json({
      message: 'Password reset successfully',
      token,
      role: type === 'driver' ? 'driver' : account.role,
    });
  } catch (error) {
    console.error('resetPassword error:', error);
    res.status(500).json({ message: 'Password reset failed. Please try again.' });
  }
};

module.exports = {
  registerUser,
  registerDriver,
  loginUser,
  loginDriver,
  getMe,
  updateProfile,
  requestOTP,
  verifyOTP,
  forgotPassword,
  resetPassword,
};