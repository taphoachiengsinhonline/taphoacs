const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const Order = require('../models/Order');
const User = require('../models/User');
const bcrypt = require('bcrypt');
const { sendPushNotificationToCustomer } = require('../utils/sendPushNotification');

// Route POST để tạo shipper mới
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { email, password, name, phone, vehicleType, licensePlate } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email đã tồn tại' });
    }

    const shipper = new User({
      email,
      password,
      name,
      phone,
      role: 'shipper',
      shipperProfile: {
        vehicleType,
        licensePlate
      }
    });

    await shipper.save();

    res.status(201).json({
      _id: shipper._id,
      email: shipper.email,
      role: shipper.role,
      shipperProfile: shipper.shipperProfile
    });
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});

// FIX: Sửa hoàn toàn endpoint update location
router.post('/update-location', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    
    // ✅ FIX: Chỉ cập nhật các trường liên quan đến vị trí
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          location: {
            type: 'Point',
            coordinates: [longitude, latitude]
          },
          locationUpdatedAt: new Date(),
          isAvailable: true
        }
      },
      {
        new: true, // Trả về document sau khi update
        runValidators: false, // ✅ QUAN TRỌNG: Tắt validation
        context: 'query' // ✅ Tránh lỗi context
      }
    );

    // ✅ Kiểm tra kết quả cập nhật
    if (!updatedUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }

    console.log(`[SHIPPER] Cập nhật vị trí thành công cho ${updatedUser.email}:`, {
      coordinates: updatedUser.location.coordinates,
      updatedAt: updatedUser.locationUpdatedAt.toISOString()
    });
    
    res.json({ 
      message: 'Cập nhật vị trí thành công',
      location: updatedUser.location,
      updatedAt: updatedUser.locationUpdatedAt.toISOString()
    });
  } catch (error) {
    console.error('Lỗi cập nhật vị trí:', error);
    res.status(500).json({ message: 'Lỗi cập nhật vị trí: ' + error.message });
  }
});


// Các route khác giữ nguyên
router.get('/assigned-orders', verifyToken, async (req, res) => {
  try {
    const orders = await Order.find({ 
      shipper: req.user._id,
      status: { $in: ['Đang giao', 'Đã nhận'] }
    }).sort('-createdAt');
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});

router.put('/orders/:id/status', verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, shipper: req.user._id },
      { status },
      { new: true }
    );
    
    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }
    
    if (typeof sendPushNotificationToCustomer === 'function') {
      sendPushNotificationToCustomer(order.user, `Trạng thái đơn hàng: ${status}`);
    }
    
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});

router.get('/stats', verifyToken, async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments({ shipper: req.user._id });

    const orders = await Order.find({
      shipper: req.user._id,
      status: 'Hoàn thành'
    });

    const totalRevenue = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    res.json({ totalOrders, totalRevenue });
  } catch (error) {
    res.status(500).json({ message: 'Lỗi khi lấy thống kê: ' + error.message });
  }
});

const Notification = require('../models/Notification');

router.get('/notifications', verifyToken, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort('-createdAt')
      .limit(20);
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi khi lấy thông báo: ' + error.message });
  }
});

module.exports = router;
