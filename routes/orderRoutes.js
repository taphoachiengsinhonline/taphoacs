// routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { verifyToken, isAdminMiddleware } = require('../middlewares/authMiddleware');
const sendPushNotification = require('../utils/sendPushNotification');
const User = require('../models/User');

// Tạo đơn hàng mới (người dùng đã đăng nhập)
router.post('/', verifyToken, async (req, res) => {
  try {
    // Đọc các trường trực tiếp từ body
    const { 
      items, 
      total, 
      phone, 
      shippingAddress, 
      customerName, 
      paymentMethod 
    } = req.body;

    const newOrder = new Order({
      items,
      total,
      phone,          // Lấy trực tiếp
      shippingAddress,// Lấy trực tiếp
      customerName,   // Lấy trực tiếp
      user: req.user._id,
      status: 'Chờ xác nhận',
      paymentMethod
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
});

// Lấy đơn hàng cá nhân, có thể lọc theo status
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const { status } = req.query;
    const query = { user: req.user._id };
    if (status) query.status = status;

    const orders = await Order.find(query).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy đơn hàng của bạn', error: err.message });
  }
});

// Lấy tất cả đơn hàng (chỉ admin), có thể lọc theo status
router.get('/', verifyToken, isAdminMiddleware, async (req, res) => {
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
});

// Admin cập nhật trạng thái đơn hàng
router.put('/:id', verifyToken, isAdminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    
    // Chỉ cập nhật trường status và tắt validate
    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { 
        new: true,
        runValidators: true, // ✅ Validate riêng trường status
        context: 'query',   // ⚠️ Bắt buộc để validate enum
        omitUndefined: true // Bỏ qua các trường undefined
      }
    );

    if (!updatedOrder) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    res.json({ 
      message: 'Cập nhật trạng thái thành công', 
      order: updatedOrder 
    });
  } catch (err) {
    console.error('Lỗi cập nhật đơn hàng:', err);
    
    // Xử lý lỗi enum
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        message: 'Trạng thái không hợp lệ',
        validStatuses: [
          'Chờ xác nhận',
          'Đang xử lý',
          'Đang giao',
          'Đã giao',
          'Đã hủy'
        ]
      });
    }

    res.status(500).json({ 
      message: 'Lỗi cập nhật đơn hàng', 
      error: process.env.NODE_ENV === 'development' ? err.message : null
    });
  }
});


// Hủy đơn hàng (người dùng)
router.put('/:id/cancel', verifyToken, async (req, res) => {
  try {
    const { cancelReason } = req.body;
    const order = await Order.findById(req.params.id);

    // Validate
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Bạn không có quyền huỷ đơn này' });
    }
    if (order.status !== 'Chờ xác nhận') {
      return res.status(400).json({ message: 'Chỉ được huỷ đơn ở trạng thái "Chờ xác nhận"' });
    }

    // Cập nhật
    order.status = 'Đã hủy';
    order.cancelReason = cancelReason;
    const updatedOrder = await order.save();

    res.json({
      message: 'Huỷ đơn thành công',
      order: updatedOrder
    });
  } catch (err) {
    console.error('Lỗi huỷ đơn hàng:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});


module.exports = router;
