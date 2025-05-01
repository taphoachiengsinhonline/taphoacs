const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { verifyToken, isAdminMiddleware } = require('../middlewares/authMiddleware');
const sendPushNotification = require('../utils/sendPushNotification');
const User = require('../models/User');

// Tạo đơn hàng mới (người dùng đã đăng nhập)
router.post('/', verifyToken, async (req, res) => {
  try {
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
      phone,
      shippingAddress,
      customerName,
      user: req.user._id,
      status: 'Chờ xác nhận',
      paymentMethod
    });

    const savedOrder = await newOrder.save();

    // Gửi thông báo cho admin
    const admins = await User.find({ 
      isAdmin: true,
      expoPushToken: { $exists: true, $ne: null } 
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
    res.status(500).json({ 
      message: 'Lỗi tạo đơn hàng', 
      error: err.message 
    });
  }
});

// Lấy đơn hàng cá nhân
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const { status } = req.query;
    const query = { user: req.user._id };
    if (status) query.status = status;

    const orders = await Order.find(query)
      .populate({
        path: 'user',
        select: '_id name',
        options: { lean: true }
      })
      .lean()
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ 
      message: 'Lỗi lấy đơn hàng của bạn', 
      error: err.message 
    });
  }
});

// Lấy chi tiết đơn hàng
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate({
        path: 'user',
        select: '_id name',
        options: { lean: true }
      })
      .lean();

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    // Xử lý user null
    order.user = order.user || { _id: null, name: 'Khách hàng' };
    
    res.json(order);
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Lấy tất cả đơn hàng (admin)
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
    res.status(500).json({ 
      message: 'Lỗi lấy danh sách đơn hàng', 
      error: err.message 
    });
  }
});

// Admin cập nhật trạng thái
router.put('/:id', verifyToken, isAdminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    
    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { 
        new: true,
        runValidators: true,
        context: 'query',
        omitUndefined: true
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

,// Huỷ đơn hàng (user)
router.put('/:id/cancel', verifyToken, async (req, res) => {
  try {
    const orderId = req.params.id;
    const { cancelReason } = req.body;

    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Không tìm thấy đơn hàng' 
      });
    }

    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        status: 'error',
        message: 'Bạn không có quyền huỷ đơn này' 
      });
    }

    if (order.status !== 'Chờ xác nhận') {
      return res.status(400).json({ 
        status: 'error',
        message: 'Chỉ huỷ được đơn ở trạng thái "Chờ xác nhận"' 
      });
    }

    order.status = 'Đã hủy';
    order.cancelReason = cancelReason;
    await order.save();

    res.json({ 
      status: 'success',
      data: order.toObject() 
    });
  } catch (error) {
    console.error('Lỗi huỷ đơn hàng:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Lỗi server khi huỷ đơn' 
    });
  }
});

module.exports = router;
