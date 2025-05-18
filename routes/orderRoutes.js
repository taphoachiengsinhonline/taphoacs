// routes/orderRoutes.js
const orderController = require('../controllers/orderController');
const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { verifyToken, isAdminMiddleware } = require('../middlewares/authMiddleware');
const sendPushNotification = require('../utils/sendPushNotification');
const User = require('../models/User');

// Tạo đơn hàng mới (người dùng đã đăng nhập)
router.post('/', verifyToken, orderController.createOrder);
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
    console.error('[BACKEND] Lỗi tạo đơn hàng:', err.message, err.stack);
    res.status(500).json({ message: 'Lỗi tạo đơn hàng', error: err.message });
  }
});

// Lấy đơn hàng cá nhân, có thể lọc theo status
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const { status } = req.query;
    const userId = req.user._id;
    console.log('[BACKEND] Lấy đơn hàng của user:', userId, 'Status filter:', status);

    const query = { user: userId };
    if (status) query.status = status;

    const orders = await Order.find(query).sort({ createdAt: -1 });
    console.log('[BACKEND] Tìm được đơn:', orders.length);

    return res.status(200).json(orders);
  } catch (err) {
    console.error('[BACKEND] Lỗi lấy đơn hàng của user:', err);
    return res.status(500).json({ message: 'Lỗi server khi lấy đơn hàng của bạn' });
  }
});




router.get(
  '/count-by-status',
  verifyToken,
  async (req, res) => {
    try {
      // Lấy tất cả đơn của user
      const all = await Order.find({ user: req.user._id });
      // Đếm theo trạng thái
      const counts = all.reduce((acc, o) => {
        switch (o.status) {
          case 'Chờ xác nhận': acc.pending   = (acc.pending   || 0) + 1; break;
          case 'Đang xử lý':    acc.confirmed = (acc.confirmed || 0) + 1; break;
          case 'Đang giao':     acc.shipped   = (acc.shipped   || 0) + 1; break;
          case 'Đã giao':       acc.delivered = (acc.delivered || 0) + 1; break;
          case 'Đã huỷ':        acc.canceled  = (acc.canceled  || 0) + 1; break;
          default: /* bỏ qua các trạng thái khác */;
        }
        return acc;
      }, { pending:0, confirmed:0, shipped:0, delivered:0, canceled:0,  });

      return res.status(200).json(counts);
    } catch (err) {
      console.error('[BACKEND] Lỗi đếm đơn theo status:', err);
      return res
        .status(500)
        .json({ message: 'Lỗi khi đếm đơn hàng theo trạng thái' });
    }
  }
);


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
    console.error('[BACKEND] Lỗi lấy danh sách đơn hàng:', err.message, err.stack);
    res.status(500).json({ message: 'Lỗi lấy danh sách đơn hàng', error: err.message });
  }
});

// Admin cập nhật trạng thái đơn hàng
router.put('/:id', verifyToken, isAdminMiddleware, async (req, res) => {
  console.log('[BACKEND] Nhận yêu cầu cập nhật đơn hàng (admin):', {
    orderId: req.params.id,
    body: req.body,
    userId: req.user._id,
    isAdmin: req.user.isAdmin
  });

  try {
    const { status } = req.body;
    if (!status) {
      console.log('[BACKEND] Thiếu trường status');
      return res.status(400).json({ message: 'Thiếu trường status' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      console.log('[BACKEND] Không tìm thấy đơn hàng:', req.params.id);
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    order.status = status;
    const updatedOrder = await order.save();

    console.log('[BACKEND] Cập nhật đơn hàng thành công (admin):', updatedOrder);
    res.json({ 
      message: 'Cập nhật trạng thái thành công', 
      order: updatedOrder 
    });
  } catch (err) {
    console.error('[BACKEND] Lỗi cập nhật đơn hàng (admin):', err.message, err.stack);
    
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        message: 'Trạng thái không hợp lệ',
        validStatuses: [
          'Chờ xác nhận',
          'Đang xử lý',
          'Đang giao',
          'Đã giao',
          'Đã huỷ'
        ]
      });
    }

    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'ID đơn hàng không hợp lệ' });
    }

    res.status(500).json({ 
      message: 'Lỗi cập nhật đơn hàng', 
      error: process.env.NODE_ENV === 'development' ? err.message : null
    });
  }
});

// Người dùng hoặc admin hủy đơn hàng
router.put('/:id/cancel', verifyToken, async (req, res) => {
  console.log('=== BẮT ĐẦU XỬ LÝ HỦY ĐƠN ===');
  console.log('User ID:', req.user._id);
  console.log('Is Admin:', req.user.isAdmin);
  console.log('Order ID:', req.params.id);
  console.log('[BACKEND] Nhận yêu cầu hủy đơn hàng:', {
    orderId: req.params.id,
    userId: req.user._id,
    isAdmin: req.user.isAdmin
  });

  try {
    const query = req.user.isAdmin 
      ? { _id: req.params.id }
      : { _id: req.params.id, user: req.user._id };

    const order = await Order.findOne(query);
    if (!order) {
      console.log('[BACKEND] Không tìm thấy đơn hàng hoặc không có quyền:', req.params.id);
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng hoặc bạn không có quyền' });
    }

    if (order.status !== 'Chờ xác nhận') {
      console.log('[BACKEND] Đơn hàng không thể hủy, trạng thái hiện tại:', order.status);
      return res.status(400).json({ 
        message: 'Chỉ có thể hủy đơn hàng ở trạng thái "Chờ xác nhận"' 
      });
    }

    order.status = 'Đã hủy';
    const updatedOrder = await order.save();

    console.log('[BACKEND] Hủy đơn hàng thành công:', updatedOrder);
    res.json({ 
      message: 'Hủy đơn hàng thành công', 
      order: updatedOrder 
    });
  } catch (err) {
    console.error('[BACKEND] Lỗi hủy đơn hàng:', err.message, err.stack);
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'ID đơn hàng không hợp lệ' });
    }
    res.status(500).json({ 
      message: 'Lỗi hủy đơn hàng', 
      error: process.env.NODE_ENV === 'development' ? err.message : null
    });
  }
  console.log('=== KẾT THÚC XỬ LÝ HỦY ĐƠN ===');
});

module.exports = router;
