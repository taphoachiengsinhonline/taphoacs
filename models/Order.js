// routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { verifyToken, isAdminMiddleware } = require('../middleware/authMiddleware');

// Tạo đơn hàng
router.post('/', verifyToken, async (req, res) => {
  const { items, total, phone, shippingAddress, note, paymentMethod } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'Đơn hàng phải có ít nhất 1 sản phẩm' });
  }

  try {
    const order = new Order({
      user: req.user._id,
      items,
      total,
      phone,
      shippingAddress,
      note,
      paymentMethod
    });

    const savedOrder = await order.save();
    res.status(201).json(savedOrder);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi tạo đơn hàng', error: error.message });
  }
});

// Lấy đơn hàng của người dùng hiện tại
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate('items.product', 'name thumbnail');

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi lấy đơn hàng của bạn', error: error.message });
  }
});

// Lấy tất cả đơn hàng (admin)
router.get('/admin', verifyToken, isAdminMiddleware, async (req, res) => {
  try {
    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .populate('user', 'name email phone')
      .populate('items.product', 'name thumbnail');

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi lấy danh sách đơn hàng', error: error.message });
  }
});

// Lấy chi tiết đơn hàng theo ID (admin hoặc chính chủ)
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('items.product', 'name thumbnail');

    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });

    // Nếu không phải admin và không phải chủ đơn
    if (!req.user.isAdmin && String(order.user._id) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Bạn không có quyền xem đơn hàng này' });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi lấy chi tiết đơn hàng', error: error.message });
  }
});

// Cập nhật trạng thái đơn hàng (admin)
router.put('/:id/status', verifyToken, isAdminMiddleware, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'shipping', 'delivered', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: 'Trạng thái không hợp lệ' });
  }

  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    )
      .populate('user', 'name email')
      .populate('items.product', 'name thumbnail');

    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi cập nhật trạng thái', error: error.message });
  }
});

module.exports = router;
