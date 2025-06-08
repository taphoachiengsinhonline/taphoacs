// controllers/shipperController.js
const Order = require('../models/Order');
const User = require('../models/User');
const sendPushNotificationToCustomer = require('./sendPushNotificationToCustomer');


const getCurrentMonthRange = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: startOfMonth.toISOString(),
    end:   endOfMonth.toISOString()
  };
};

exports.getOrderCounts = async (req, res) => {
  try {
    const { start, end } = getCurrentMonthRange();
    const counts = await Order.aggregate([
      { $match: {
    shipper: req.user._id,
    "timestamps.acceptedAt": { $gte: new Date(start), $lte: new Date(end) }
}},

      { $group: { _id: "$status", count: { $sum: 1 } }},
      { $group: {
          _id: null,
          total: { $sum: "$count" },
          counts: { $push: { status: "$_id", count: "$count" } }
      }}
    ]);
    const result = {
      total: counts[0]?.total || 0,
      'Chờ xác nhận': 0,
      'Đang xử lý': 0,
      'Đang giao': 0,
      'Đã giao': 0,
      'Đã huỷ': 0
    };
    if (counts[0]?.counts) {
      counts[0].counts.forEach(item => {
        result[item.status] = item.count;
      });
    }
    res.json(result);
  } catch (error) {
    console.error('[getOrderCounts] error:', error);
    res.status(500).json({ message: 'Lỗi server khi đếm đơn hàng' });
  }
};

exports.acceptOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Đơn hàng không tồn tại' });
    if (order.status !== 'Chờ xác nhận') return res.status(400).json({ message: 'Đơn không khả dụng' });

    order.status = 'Đang xử lý';
    order.shipper = req.user._id;
    order.timestamps.acceptedAt = new Date();
    
    const updated = await order.save();
    
    // Gửi thông báo cho khách hàng
    const customer = await User.findById(order.user);
    if (customer?.fcmToken) {
      await sendPushNotificationToCustomer(customer.fcmToken, {
        title: 'Đơn hàng của bạn đã được nhận',
        body: `Đơn hàng #${order._id.toString().slice(-6)} đã có shipper nhận. Vui lòng chờ giao hàng!`
      });
    }
    
    res.json({ 
      message: 'Nhận đơn thành công',
      order: { ...updated.toObject(), timestamps: updated.timestamps }
    });
  } catch (error) {
    console.error('Lỗi nhận đơn:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
