// ── One-time password repair script ──
// Run with: node fixPassword.js
// Place this file in your project root, run it ONCE, then delete it.

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

// Paste the email and new password you want to set
const EMAIL = 'youremail@example.com';   // ← change this
const NEW_PASSWORD = 'yournewpassword';  // ← change this (min 6 chars)

async function fix() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  // Try User collection first
  const User = require('./models/User.model');
  const Driver = require('./models/Driver.model');

  let account = await User.findOne({ email: EMAIL });
  let Model = User;

  if (!account) {
    account = await Driver.findOne({ email: EMAIL });
    Model = Driver;
  }

  if (!account) {
    console.error('❌ No account found for', EMAIL);
    process.exit(1);
  }

  // Hash once and update directly — bypasses pre-save hook
  const hashed = await bcrypt.hash(NEW_PASSWORD, SALT_ROUNDS);
  await Model.findByIdAndUpdate(account._id, { password: hashed });

  console.log('✅ Password fixed for', EMAIL);
  console.log('You can now log in with your new password.');
  process.exit(0);
}

fix().catch(err => {
  console.error('Script failed:', err.message);
  process.exit(1);
});