const mongoose = require('mongoose');
const nowUTC = Date.now();                       
const sevenHours = 7 * 60 * 60 * 1000;           
const nowVNDateObj = new Date(nowUTC + sevenHours);

const pendingDeliverySchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true
  },
  triedShippers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  retryCount: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'assigned', 'failed'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: nowVNDateObj,
    expires: 300 // 5 phút
  }
});

module.exports = mongoose.model('PendingDelivery', pendingDeliverySchema);
