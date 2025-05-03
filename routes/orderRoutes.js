// routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { verifyToken, isAdminMiddleware } = require('../middlewares/authMiddleware');
const sendPushNotification = require('../utils/sendPushNotification');
const User = require('../models/User');

// Tạo đơn hàng mới
router.post('/', verifyToken, async (req, res) => {
  try {
    const { items, total, phone, shippingAddress, customerName, paymentMethod } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Danh sách sản phẩm không hợp lệ' });
    }
    if (!total || typeof total !== 'number' || total <= 0) {
      return res.status(400).json({ message: 'Tổng tiền không hợp lệ' });
    }
    if (!phone || !/^(0[3|5|7|8|9]|84[3|5|7|8|9]|\+84[3|5|7|8|9])+([0-9]{7,8})$/.test(phone)) {
      return res.status(400).json({ message: 'Số điện thoại không hợp lệ' });
    }
    if (!shippingAddress || shippingAddress.length < 10) {
      return res.status(400).json({ message: 'Địa chỉ giao hàng không hợp lệ' });
    }
    if (!customerName) {
      return res.status(400).json({ message: 'Tên khách hàng là bắt buộc' });
    }

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

    const admins = await User.find({
      isAdmin: true,
      expoPushToken: { $exists: true, $ne: null },
    });
    for (const admin of admins) {
      try {
        await sendPushNotification(
          admin.expoPushToken,
          '🛒 Có đơn hàng mới!',
          `Người dùng ${req.user.name || 'khách'} vừa đặt hàng. Tổng: ${total.toLocaleString()}đ`
        );
      } catch (notifyErr) {
        console.error(`Lỗi gửi thông báo đến admin ${admin._id}:`, notifyErr.message);
      }
    }

    res.status(201).json(savedOrder);
  } catch (err) {
    console.error('Lỗi tạo đơn hàng:', err);
    res.status(500).json({ message: 'Lỗi tạo đơn hàng', error: err.message });
  }
});

// Lấy đơn hàng cá nhân
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const { status } = req.query;
    const query = { user: req.user._id };
    if (status) query.status = status;
    const orders = await Order.find(query)
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error('Lỗi lấy đơn hàng:', err);
    res.status(500).json({ message: 'Lỗi lấy đơn hàng của bạn', error: err.message });
  }
});

// Lấy tất cả đơn hàng (admin)
router.get('/', verifyToken, isAdminMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = status ? { status } : {};
    const orders = await Order.find(query)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    const total = await Order.countDocuments(query);
    res.json({ orders, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('Lỗi lấy danh sách đơn hàng:', err);
    res.status(500).json({ message: 'Lỗi lấy danh sách đơn hàng', error: err.message });
  }
});

// Lấy chi tiết đơn hàng theo ID
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'name email');
    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }
    if (order.user.toString() !== req.user._id.toString() && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Bạn không có quyền xem đơn hàng này' });
    }
    res.json(order);
  } catch (err) {
    console.error('Lỗi lấy chi tiết đơn hàng:', err);
    res.status(500).json({ message: 'Lỗi lấy chi tiết đơn hàng', error: err.message });
  }
});

// Hủy đơn hàng (người dùng)
router.put('/:id/cancel', verifyToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Không có quyền huỷ đơn' });
    }
    if (order.status !== 'Chờ xác nhận') {
      return res.status(400).json({ message: 'Chỉ được huỷ đơn ở trạng thái "Chờ xác nhận"' });
    }
    if (!req.body.cancelReason) {
      return res.status(400).json({ message: 'Vui lòng cung cấp lý do hủy đơn' });
    }

    order.status = 'Đã hủy';
    order.cancelReason = req.body.cancelReason;
    await order.save();

    const admins = await User.find({
      isAdmin: true,
      expoPushToken: { $exists: true, $ne: null },
    });
    for (const admin of admins) {
      try {
        await sendPushNotification(
          admin.expoPushToken,
          '❌ Đơn hàng bị hủy',
          `Đơn hàng #${order._id.toString().slice(-4)} đã bị hủy bởi ${req.user.name || 'khách'}. Lý do: ${req.body.cancelReason}`
        );
      } catch (notifyErr) {
        console.error(`Lỗi gửi thông báo đến admin ${admin._id}:`, notifyErr.message);
      }
    }

    res.json({ status: 'success', message: 'Huỷ đơn thành công', order });
  } catch (err) {
    console.error('Lỗi huỷ đơn:', err);
    res.status(500).json({ status: 'error', message: 'Lỗi server', error: err.message });
  }
});

// Cập nhật trạng thái đơn hàng (admin)
router.put('/:id', verifyToken, isAdminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['Chờ xác nhận', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã hủy'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Trạng thái không hợp lệ', validStatuses });
    }

    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true, context: 'query', omitUndefined: true }
    );
    if (!updatedOrder) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    if (updatedOrder.user) {
      const user = await User.findById(updatedOrder.user);
      if (user && user.expoPushToken) {
        try {
          await sendPushNotification(
            user.expoPushToken,
            '📦 Cập nhật đơn hàng',
            `Đơn hàng #${updatedOrder._id.toString().slice(-4)} đã được cập nhật thành: ${status}`
          );
        } catch (notifyErr) {
          console.error(`Lỗi gửi thông báo đến user ${user._id}:`, notifyErr.message);
        }
      }
    }

    res.json({ message: 'Cập nhật trạng thái thành công', order: updatedOrder });
  } catch (err) {
    console.error('Lỗi cập nhật đơn hàng:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        message: 'Trạng thái không hợp lệ',
        validStatuses: ['Chờ xác nhận', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã hủy']
      });
    }
    res.status(500).json({ message: 'Lỗi cập nhật đơn hàng', error: err.message });
  }
});

module.exports = router;
