const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const Order = require('../models/Order');
const User = require('../models/User');
const bcrypt = require('bcrypt');
const { sendPushNotificationToCustomer } = require('../utils/sendPushNotification'); // Đảm bảo import hàm này

// Route POST để tạo shipper mới
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { email, password, name, phone, vehicleType, licensePlate } = req.body;

    // Kiểm tra xem email đã tồn tại chưa
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email đã tồn tại' });
    }

    // Tạo shipper mới
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

    // Trả về thông tin shipper vừa tạo
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

// FIX: Thêm xử lý lỗi và log cho endpoint cập nhật vị trí
router.post('/update-location', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    
    // Validate input
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ message: 'Tọa độ không hợp lệ' });
    }
    
    // FIX: Sử dụng tùy chọn { new: true } để trả về document đã cập nhật
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        location: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        locationUpdatedAt: new Date(),
        isAvailable: true
      },
      { new: true } // QUAN TRỌNG: trả về document sau khi update
    );
    
    // FIX: Log kết quả cập nhật để debug
    console.log(`[SHIPPER] Cập nhật vị trí thành công cho ${req.user.email}:`, {
      coordinates: updatedUser.location.coordinates,
      updatedAt: updatedUser.locationUpdatedAt
    });
    
    res.json({ 
      message: 'Cập nhật vị trí thành công',
      location: updatedUser.location,
      updatedAt: updatedUser.locationUpdatedAt
    });
  } catch (error) {
    console.error('Lỗi cập nhật vị trí:', error);
    res.status(500).json({ message: 'Lỗi cập nhật vị trí: ' + error.message });
  }
});

// Các route hiện có - KHÔNG THAY ĐỔI
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
    
    // FIX: Kiểm tra hàm sendPushNotificationToCustomer có tồn tại
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

// FIX: Thêm endpoint mới để debug trạng thái shipper
router.get('/debug-status', verifyToken, async (req, res) => {
  try {
    const shipper = await User.findById(req.user._id)
      .select('name email location locationUpdatedAt isAvailable');
    
    res.json({
      status: 'success',
      shipper: {
        ...shipper.toObject(),
        lastUpdateSeconds: shipper.locationUpdatedAt 
          ? Math.floor((new Date() - new Date(shipper.locationUpdatedAt)) / 1000)
          : null
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Lỗi debug: ' + error.message });
  }
});

module.exports = router;
