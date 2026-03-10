const mongoose = require('mongoose');

const OTPSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    otp: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 300  // automatically delete after 5 minutes (300 seconds)
    }
});

module.exports = mongoose.model('OTP', OTPSchema);
