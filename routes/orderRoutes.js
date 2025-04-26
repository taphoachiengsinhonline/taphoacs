// routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const { verifyToken, isAdminMiddleware } = require('../middlewares/authMiddleware');
const { getMyOrders, cancelMyOrder } = require('../controllers/orderController');
const Order = require('../models/Order');
const sendPushNotification = require('../utils/sendPushNotification');
const User = require('../models/User');

// Tạo đơn hàng
router.post('/', verifyToken, async (req, res) => {
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

    // 🔔 Gửi thông báo push
    const admins = await User.find({ isAdmin: true, expoPushToken: { $exists: true, $ne: null } });
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
});

// Lấy đơn hàng cá nhân, có thể lọc trạng thái
router.get('/my-orders', verifyToken, getMyOrders);

// Huỷ đơn hàng của chính mình
router.put('/my-orders/:id/cancel', verifyToken, cancelMyOrder);

// Lấy tất cả đơn hàng (admin)
router.get('/', verifyToken, isAdminMiddleware, async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('user', 'name email')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy danh sách đơn hàng', error: err.message });
  }
});

module.exports = router;
