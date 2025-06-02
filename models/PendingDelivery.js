const mongoose = require('mongoose');

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
  status: {
    type: String,
    enum: ['pending', 'assigned', 'failed'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300 // 5 phút sau sẽ tự xóa nếu chưa được xử lý
  }
});

module.exports = mongoose.model('PendingDelivery', pendingDeliverySchema);

