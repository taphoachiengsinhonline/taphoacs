const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const auth = require('../middlewares/auth'); // kiểm tra đăng nhập
const isAdmin = require('../middlewares/isAdmin'); // kiểm tra admin

// Tạo đơn hàng mới
router.post('/', auth, async (req, res) => {
  try {
    const { items, total, phone, shippingAddress, note, paymentMethod } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Đơn hàng không có sản phẩm nào' });
    }

    const newOrder = new Order({
      user: req.user._id,
      items,
      total,
      phone,
      shippingAddress,
      note,
      paymentMethod: paymentMethod || 'COD'
    });

    const savedOrder = await newOrder.save();
    res.status(201).json(savedOrder);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi tạo đơn hàng', error: err.message });
  }
});

// Lấy đơn hàng của người dùng đã đăng nhập
router.get('/my-orders', auth, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy đơn hàng', error: err.message });
  }
});

// Lấy tất cả đơn hàng (chỉ admin)
router.get('/', auth, isAdmin, async (req, res) => {
  try {
    const orders = await Order.find().populate('user', 'name email').sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy danh sách đơn hàng', error: err.message });
  }
});

module.exports = router;

