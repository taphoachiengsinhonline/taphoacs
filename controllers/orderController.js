// controllers/orderController.js
const Order = require('../models/Order');
const User = require('../models/User');
const sendPushNotification = require('../utils/sendPushNotification');

// Tạo đơn hàng mới
exports.createOrder = async (req, res) => {
  try {
    const { items, total, customerInfo } = req.body;

    const newOrder = new Order({
      items,
      total,
      customerInfo,
      user: req.user._id,
      status: 'pending',
    });

    const savedOrder = await newOrder.save();

    const admins = await User.find({
      isAdmin: true,
      expoPushToken: { $exists: true, $ne: null },
    });

    for (const admin of admins) {
      await sendPushNotification(
        admin.expoPushToken,
        '🛒 Có đơn hàng mới!',
        `Người dùng ${req.user.name || 'khách'} vừa đặt hàng. Tổng: ${total.toLocaleString()}đ`
      );
    }

    res.status(201).json(savedOrder);
  } catch (err) {
    console.error('Lỗi tạo đơn hàng:', err);
    res.status(500).json({ message: 'Lỗi tạo đơn hàng', error: err.message });
  }
};

// Lấy đơn hàng của user đang đăng nhập
exports.getMyOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const query = { user: req.user._id };
    if (status) query.status = status;

    const orders = await Order.find(query).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy đơn hàng cá nhân', error: err.message });
  }
};

// Admin lấy tất cả đơn hàng
exports.getAllOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status) query.status = status;

    const orders = await Order.find(query)
      .populate('user', 'name email')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy danh sách đơn hàng', error: err.message });
  }
};

// Admin cập nhật trạng thái đơn hàng
exports.updateOrderStatus = async (req, res) => {
  console.log('Nhận yêu cầu cập nhật trạng thái:', req.params.id, req.body); // 🛠️ Thêm dòng này

  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    order.status = status || order.status;
    await order.save();

    res.json({ message: 'Cập nhật trạng thái thành công', order });
  } catch (err) {
    console.error('Lỗi cập nhật trạng thái:', err);
    res.status(500).json({ message: 'Lỗi cập nhật trạng thái đơn hàng', error: err.message });
  }
};

