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
      expoPushToken: { $exists: true, $ne: null },
    }).select('expoPushToken');

    const notificationPromises = admins.map(admin => 
      sendPushNotification(
        admin.expoPushToken,
        '🛒 Có đơn hàng mới!',
        `Người dùng ${req.user.name || 'khách'} vừa đặt hàng. Tổng: ${total.toLocaleString()}đ`
      )
    );

    await Promise.all(notificationPromises);

    res.status(201).json({
      success: true,
      order: savedOrder
    });

  } catch (err) {
    console.error('[ERROR] Lỗi tạo đơn hàng:', err);
    res.status(500).json({
      success: false,
      message: 'Lỗi tạo đơn hàng',
      error: process.env.NODE_ENV === 'development' ? err.message : null
    });
  }
});

// Lấy chi tiết đơn hàng
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', '_id name email')
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đơn hàng'
      });
    }

    res.json({
      success: true,
      order
    });

  } catch (error) {
    console.error('[ERROR] Lỗi lấy đơn hàng:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống',
      error: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

// Lấy đơn hàng cá nhân
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const { status } = req.query;
    const query = { user: req.user._id };
    
    if (status) {
      if (!['Chờ xác nhận', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã hủy'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Trạng thái không hợp lệ'
        });
      }
      query.status = status;
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .populate('user', 'name email');

    res.json({
      success: true,
      count: orders.length,
      orders
    });

  } catch (err) {
    console.error('[ERROR] Lỗi lấy đơn hàng:', err);
    res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống',
      error: process.env.NODE_ENV === 'development' ? err.message : null
    });
  }
});

// Lấy tất cả đơn hàng (Admin)
router.get('/', verifyToken, isAdminMiddleware, async (req, res) => {
  try {
    const { status, user } = req.query;
    const query = {};

    if (status) {
      if (!['Chờ xác nhận', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã hủy'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Trạng thái không hợp lệ'
        });
      }
      query.status = status;
    }

    if (user) query.user = user;

    const orders = await Order.find(query)
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: orders.length,
      orders
    });

  } catch (err) {
    console.error('[ERROR] Lỗi lấy đơn hàng:', err);
    res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống',
      error: process.env.NODE_ENV === 'development' ? err.message : null
    });
  }
});

// Cập nhật trạng thái đơn hàng (Admin)
router.put('/:id', verifyToken, isAdminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!status || !['Chờ xác nhận', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã hủy'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Trạng thái không hợp lệ'
      });
    }

    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { 
        new: true,
        runValidators: true,
        context: 'query'
      }
    ).populate('user', 'name email');

    if (!updatedOrder) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đơn hàng'
      });
    }

    res.json({
      success: true,
      message: 'Cập nhật thành công',
      order: updatedOrder
    });

  } catch (err) {
    console.error('[ERROR] Lỗi cập nhật đơn hàng:', err);
    res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống',
      error: process.env.NODE_ENV === 'development' ? err.message : null
    });
  }
});

// Huỷ đơn hàng (Người dùng)
router.put('/:id/cancel', verifyToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', '_id');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đơn hàng'
      });
    }

    if (order.status !== 'Chờ xác nhận') {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể huỷ đơn ở trạng thái "Chờ xác nhận"'
      });
    }

    if (order.user._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Không có quyền thực hiện hành động này'
      });
    }

    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      {
        status: 'Đã hủy',
        cancelReason: req.body.cancelReason,
        cancelledAt: new Date()
      },
      { new: true }
    ).populate('user', 'name email');

    // Gửi thông báo cho admin
    const admins = await User.find({
      isAdmin: true,
      expoPushToken: { $exists: true, $ne: null },
    }).select('expoPushToken');

    const notificationPromises = admins.map(admin => 
      sendPushNotification(
        admin.expoPushToken,
        '❌ Đơn hàng bị huỷ',
        `Đơn hàng ${updatedOrder._id} đã bị huỷ bởi khách hàng`
      )
    );

    await Promise.all(notificationPromises);

    res.json({
      success: true,
      message: 'Huỷ đơn hàng thành công',
      order: updatedOrder
    });

  } catch (error) {
    console.error('[ERROR] Lỗi huỷ đơn hàng:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống',
      error: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

module.exports = router;
