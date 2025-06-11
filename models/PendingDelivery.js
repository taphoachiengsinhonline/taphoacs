const mongoose = require('mongoose');
const nowUTC = Date.now();                       // miliseconds kể từ 1970 tại UTC
const sevenHours = 7 * 60 * 60 * 1000;           // 7 giờ = 7*60*60*1000 ms
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
  status: {
    type: String,
    enum: ['pending', 'assigned', 'failed'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: nowVNDateObj,
    expires: 300 // 5 phút sau sẽ tự xóa nếu chưa được xử lý
  }
});

module.exports = mongoose.model('PendingDelivery', pendingDeliverySchema);
