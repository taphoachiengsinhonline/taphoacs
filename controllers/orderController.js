// controllers/orderController.js
const Order = require('../models/Order');

exports.createOrder = async (req, res) => {
  try {
    const { items, total, customerInfo, status } = req.body;

    const newOrder = new Order({
      items,
      total,
      customerInfo,
      status: status || 'pending',
      createdAt: new Date()
    });

    await newOrder.save();

    res.status(201).json({ success: true, order: newOrder });
  } catch (error) {
    console.error('❌ Lỗi tạo đơn hàng:', error);
    res.status(500).json({ message: 'Không thể tạo đơn hàng' });
  }
};

