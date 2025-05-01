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
    const orders = await Order.find({ user: req.user._id })
      .populate({
        path: 'user',
        select: '_id name',
        options: { lean: true } // Thêm lean để trả về plain object
      })
      .lean(); // Thêm lean() ở đây

    res.json(orders);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ message: 'Lỗi server khi lấy đơn hàng' });
  }
});

// Thêm verifyToken vào route GET /:id
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

    // Xử lý trường hợp user null
    order.user = order.user || { _id: null, name: 'Khách hàng' };
    
    res.json(order);
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ message: 'Lỗi server' });
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
// Thêm endpoint huỷ đơn hàng
// Thêm route huỷ đơn hàng
router.put('/:id/cancel', verifyToken, async (req, res) => {
  try {
    const orderId = req.params.id;
    console.log(`[CANCEL] Attempting to cancel order ${orderId}`);
    
    const order = await Order.findById(orderId);
    
    if (!order) {
      console.log(`[CANCEL] Order ${orderId} not found`);
      return res.status(404).json({ 
        status: 'error',
        message: 'Không tìm thấy đơn hàng' 
      });
    }

    // Kiểm tra quyền
    if (order.user.toString() !== req.user._id.toString()) {
      console.log(`[CANCEL] User ${req.user._id} unauthorized to cancel order ${orderId}`);
      return res.status(403).json({ 
        status: 'error',
        message: 'Bạn không có quyền huỷ đơn này' 
      });
    }

    // Kiểm tra trạng thái
    if (order.status !== 'Chờ xác nhận') {
      console.log(`[CANCEL] Invalid status ${order.status} for order ${orderId}`);
      return res.status(400).json({ 
        status: 'error',
        message: 'Chỉ có thể huỷ đơn ở trạng thái "Chờ xác nhận"' 
      });
    }

    // Cập nhật
    order.status = 'Đã hủy';
    order.cancelReason = req.body.cancelReason;
    order.updatedAt = Date.now();
    
    await order.save();
    
    console.log(`[CANCEL] Order ${orderId} cancelled successfully`);
    res.json({ 
      status: 'success',
      data: order
    });

  } catch (err) {
    console.error(`[CANCEL ERROR] ${err.message}`, err.stack);
    res.status(500).json({ 
      status: 'error',
      message: 'Lỗi server khi huỷ đơn' 
    });
  }
});

module.exports = router;
