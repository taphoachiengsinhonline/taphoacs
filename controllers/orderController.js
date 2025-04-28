// controllers/orderController.js
const Order = require('../models/Order');
const User = require('../models/User');
const sendPushNotification = require('../utils/sendPushNotification');

// Tạo đơn hàng mới - ĐÃ SỬA PHẦN THÔNG TIN KHÁCH HÀNG
exports.createOrder = async (req, res) => {
  catch (err) {
  console.error('⚠️ Lỗi tạo đơn hàng full:', err);
  res.status(500).json({ message: 'Lỗi tạo đơn hàng', error: err.message });
  console.log('[DEBUG] req.body:', req.body);
  try {
    const { items, total, phone, shippingAddress } = req.body;

    const newOrder = new Order({
      items,
      total,
      user: req.user._id,
      phone,          // ✅ Thêm trường phone từ body
      shippingAddress, // ✅ Thêm trường shippingAddress từ body
      customerName: req.user.name, // Lấy từ thông tin user
      status: 'Chờ xác nhận',
    });

    const savedOrder = await newOrder.save();

    // Phần gửi thông báo giữ nguyên
    const admins = await User.find({
      isAdmin: true,
      expoPushToken: { $exists: true, $ne: null },
    });

    for (const admin of admins) {
      await sendPushNotification(
        admin.expoPushToken,
        '🛒 Có đơn hàng mới!',
        `Người dùng ${req.user.name || 'khách'} vừa đặt hàng\n`
        + `SĐT: ${phone}\n`
        + `Địa chỉ: ${shippingAddress}\n`
        + `Tổng: ${total.toLocaleString()}đ`
      );
    }

    res.status(201).json(savedOrder);
  } catch (err) {
    console.error('Lỗi tạo đơn hàng:', err);
    res.status(500).json({ message: 'Lỗi tạo đơn hàng', error: err.message });
  }
};

// Các hàm khác GIỮ NGUYÊN KHÔNG THAY ĐỔI
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

exports.updateOrderStatus = async (req, res) => {
  console.log('Nhận yêu cầu cập nhật trạng thái:', req.params.id, req.body);

  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    order.status = status || order.status;
    await order.save();

    console.log('Trạng thái đơn hàng sau khi cập nhật:', order.status);
    res.json({ message: 'Cập nhật trạng thái thành công', order });
  } catch (err) {
    console.error('Lỗi cập nhật trạng thái:', err);
    res.status(500).json({ message: 'Lỗi cập nhật trạng thái đơn hàng', error: err.message });
  }
};
