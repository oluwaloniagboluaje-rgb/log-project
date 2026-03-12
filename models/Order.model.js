const mongoose = require('mongoose');
const { randomBytes } = require('crypto');

const uuidv4 = () => randomBytes(16).toString('hex');

const TrackingEventSchema = new mongoose.Schema({
  status: { type: String, required: true },
  message: { type: String, required: true },
  locationName: { type: String },
  timestamp: { type: Date, default: Date.now },
  updatedBy: {
    role: { type: String, enum: ['user', 'driver', 'admin', 'system'] },
    id: mongoose.Schema.Types.ObjectId,
    name: String
  }
}, { _id: true });

const OrderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    default: () => `ORD-${uuidv4().slice(0, 8).toUpperCase()}`
  },

  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null },

  pickup: {
    contactName: { type: String, required: true },
    contactPhone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    postcode: { type: String, required: true },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null }
  },

  delivery: {
    contactName: { type: String, required: true },
    contactPhone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    postcode: { type: String, required: true },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    specialInstructions: { type: String }
  },

  package: {
    description: { type: String, required: true },
    weightKg: { type: Number, required: true, min: 0.1 },
    quantity: { type: Number, default: 1 },
    fragile: { type: Boolean, default: false },
    category: {
      type: String,
      enum: ['documents', 'electronics', 'clothing', 'food', 'furniture', 'machinery', 'other'],
      default: 'other'
    },
    images: [
      {
        url: { type: String, required: true },
        publicId: { type: String, required: true }
      }
    ]
  },

  pricing: {
    baseRate: { type: Number, default: 5.00 },
    weightCharge: { type: Number, default: 0 },
    distanceCharge: { type: Number, default: 0 },
    fragileCharge: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    vat: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    distanceKm: { type: Number, default: 0 },
    currency: { type: String, default: 'GBP' }
  },

  status: {
    type: String,
    enum: ['pending', 'confirmed', 'assigned', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'pending'
  },

  trackingHistory: [TrackingEventSchema],

  trackingId: {
    type: String,
    unique: true
  },
  driverLocation: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    updatedAt: { type: Date, default: null }
  },

  scheduledPickup: { type: Date },
  actualPickup: { type: Date },
  actualDelivery: { type: Date },

  requiresSignature: { type: Boolean, default: true },
  cancelReason: { type: String },
  notes: { type: String }

}, { timestamps: true });

OrderSchema.index({ user: 1 });
OrderSchema.index({ driver: 1 });
OrderSchema.index({ status: 1 });

module.exports = mongoose.model('Order', OrderSchema);