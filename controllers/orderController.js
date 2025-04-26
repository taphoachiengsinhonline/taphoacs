// controllers/orderController.js
const Order = require('../models/Order');

// Tạo đơn hàng (đã có)

exports.getMyOrders = async (req, res) => {
  try {
    const { status } = req.query; // lọc theo trạng thái nếu có
    const query = { user: req.user._id };
    if (status) {
      query.status = status;
    }
    const orders = await Order.find(query).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    console.error('❌ Lỗi lấy đơn hàng của bạn:', error);
    res.status(500).json({ message: 'Không thể lấy đơn hàng' });
  }
};

exports.cancelMyOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) {
      return res.status(404).json({ message: 'Đơn hàng không tồn tại' });
    }
    if (order.status !== 'pending' && order.status !== 'confirmed') {
      return res.status(400).json({ message: 'Không thể huỷ đơn hàng đã vận chuyển hoặc giao' });
    }

    order.status = 'cancelled';
    await order.save();
    res.json({ message: 'Đã huỷ đơn hàng thành công', order });
  } catch (error) {
    console.error('❌ Lỗi huỷ đơn:', error);
    res.status(500).json({ message: 'Không thể huỷ đơn' });
  }
};
