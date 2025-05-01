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


// routes/order.js
router.put('/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email');

    // Validate
    if (order.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể huỷ đơn ở trạng thái Chờ xác nhận'
      });
    }

    if (order.user._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Không có quyền thực hiện hành động này'
      });
    }

    // Cập nhật
    const updates = {
      status: 'cancelled',
      cancelReason: req.body.cancelReason,
      cancelledAt: Date.now()
    };

    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true }
    );

    // Gửi thông báo
    sendNotificationToAdmins({
      title: 'Đơn hàng bị huỷ',
      body: `Đơn hàng ${order._id} đã bị huỷ bởi khách hàng`,
      data: { orderId: order._id }
    });

    res.json({
      success: true,
      order: updatedOrder
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


module.exports = router;
