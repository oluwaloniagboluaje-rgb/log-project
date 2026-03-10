const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const DriverSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, default: 'driver' },
  avatar: { type: String, default: null },           // Cloudinary URL
  avatarPublicId: { type: String, default: null },   // Cloudinary public_id
  bio: { type: String, default: null },
  vehicleType: { type: String, enum: ['bike', 'van', 'truck', 'car'], default: 'van' },
  vehiclePlate: { type: String, required: true },
  vehicleModel: { type: String },
  isAvailable: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  isOnline: { type: Boolean, default: false },
  currentLocation: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    address: { type: String, default: null },
    updatedAt: { type: Date, default: null }
  },
  socketId: { type: String, default: null },
  totalDeliveries: { type: Number, default: 0 },
  rating: { type: Number, default: 5.0 }
}, { timestamps: true });

DriverSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

DriverSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

DriverSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('Driver', DriverSchema);