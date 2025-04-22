const express = require('express');
const router = express.Router();
const Order = require('../models/Order');

// Tạo đơn hàng mới
router.post('/', async (req, res) => {
  try {
    const { items, total, customerInfo, paymentMethod } = req.body;
    
    // Validate dữ liệu
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Danh sách sản phẩm không hợp lệ' 
      });
    }

    const order = new Order({
      items,
      total,
      customer: customerInfo,
      paymentMethod,
      status: 'pending'
    });

    await order.save();

    res.status(201).json({
      status: 'success',
      data: order
    });

  } catch (err) {
    console.error('Order creation error:', err);
    res.status(500).json({ 
      status: 'error',
      message: 'Lỗi server khi tạo đơn hàng' 
    });
  }
});

module.exports = router;
