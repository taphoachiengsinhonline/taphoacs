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
    
    // Sửa: Sử dụng findById thay vì findByIdAndUpdate
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }

    // Sửa: Gán giá trị trực tiếp
    user.location = {
      type: 'Point',
      coordinates: [longitude, latitude]
    };
    
    // Sửa: Đảm bảo giá trị là Date object
    user.locationUpdatedAt = new Date();
    user.isAvailable = true;

    // Sửa: Sử dụng save() với validate
    await user.save({ validateBeforeSave: true });

    console.log(`[SHIPPER] Cập nhật vị trí thành công cho ${user.email}:`, {
      coordinates: user.location.coordinates,
      updatedAt: user.locationUpdatedAt
    });
    
    res.json({ 
      message: 'Cập nhật vị trí thành công',
      location: user.location,
      updatedAt: user.locationUpdatedAt
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
