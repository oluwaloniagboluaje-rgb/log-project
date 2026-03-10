const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, required: true },
  recipientModel: { type: String, enum: ['User', 'Driver'], required: true },
  recipientRole: { type: String, enum: ['user', 'driver', 'admin'], required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: {
    type: String,
    enum: ['order_placed', 'order_assigned', 'order_picked_up', 'order_in_transit', 'order_delivered', 'order_cancelled', 'driver_assigned', 'order_out_for_delivery','general'],
    default: 'general'
  },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  orderNumber: { type: String, default: null },
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

NotificationSchema.index({ recipient: 1, isRead: 1 });

module.exports = mongoose.model('Notification', NotificationSchema);