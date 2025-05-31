// routes/admin.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const bcrypt = require('bcrypt');
const sendPushNotification = require('../utils/sendPushNotification');

// Tạo tài khoản shipper mới (chỉ admin)
router.post('/shippers', verifyToken, isAdmin, async (req, res) => {
  try {
    const { email, password, name, phone, address, shipperProfile } = req.body;
    const { vehicleType, licensePlate } = shipperProfile || {};

    // Kiểm tra thông tin bắt buộc
    if (!email || !password || !name || !phone || !address || !vehicleType || !licensePlate) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Vui lòng cung cấp đầy đủ thông tin'
      });
    }

    // Kiểm tra email đã tồn tại
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Email đã tồn tại'
      });
    }

    // Mã hóa mật khẩu
    const hashedPassword = await bcrypt.hash(password, 10);

    // Tạo shipper mới
    const shipper = new User({
      email,
      password: hashedPassword,
      name,
      address,
      phone,
      role: 'shipper',
      shipperProfile: {
        vehicleType,
        licensePlate
      }
    });

    await shipper.save();

    res.status(201).json({
      status: 'success',
      data: {
        _id: shipper._id,
        email: shipper.email,
        role: shipper.role,
        shipperProfile: shipper.shipperProfile
      }
    });
  } catch (error) {
    console.error('Error creating shipper:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Lỗi server: ' + error.message
    });
  }
});

// Lấy danh sách shipper với trạng thái online
router.get('/shippers', async (req, res) => {
  try {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);
    
    // Lấy tất cả shipper
    const allShippers = await User.find({ role: 'shipper' })
      .select('name email phone shipperProfile location locationUpdatedAt fcmToken')
      .lean();
    
    // Đánh dấu shipper online
    const shippersWithStatus = allShippers.map(shipper => {
      // Kiểm tra cập nhật vị trí trong 5 phút qua
      const hasRecentUpdate = shipper.locationUpdatedAt && 
                             new Date(shipper.locationUpdatedAt) >= fiveMinutesAgo;
      
      // Kiểm tra có vị trí hợp lệ
      const hasValidLocation = shipper.location && 
                              shipper.location.coordinates && 
                              shipper.location.coordinates.length === 2;
      
      return {
        ...shipper,
        isOnline: hasRecentUpdate && hasValidLocation
      };
    });
    
    // Đếm số lượng online
    const onlineCount = shippersWithStatus.filter(s => s.isOnline).length;
    
    // Format dữ liệu vị trí cho client
    const formattedShippers = shippersWithStatus.map(shipper => {
      if (shipper.location && shipper.location.coordinates) {
        return {
          ...shipper,
          location: {
            coordinates: [
              shipper.location.coordinates[0], // longitude
              shipper.location.coordinates[1]  // latitude
            ]
          }
        };
      }
      return shipper;
    });

    res.json({
      status: 'success',
      onlineCount,
      shippers: formattedShippers
    });
  } catch (error) {
    console.error('Error fetching shippers:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Lỗi server: ' + error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Gửi thông báo kiểm tra đến shipper
router.post('/shippers/:id/test-notification', verifyToken, isAdmin, async (req, res) => {
  try {
    const shipperId = req.params.id;
    
    // Tìm shipper
    const shipper = await User.findById(shipperId);
    if (!shipper) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Shipper không tồn tại' 
      });
    }
    
    // Kiểm tra FCM token
    if (!shipper.fcmToken) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Shipper chưa có FCM token' 
      });
    }
    
    // Gửi thông báo kiểm tra
    await sendPushNotification(
      shipper.fcmToken,
      'Kiểm tra thông báo',
      'Admin đang kiểm tra hệ thống thông báo'
    );
    
    res.json({ 
      status: 'success',
      message: 'Đã gửi thông báo kiểm tra' 
    });
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Lỗi server: ' + error.message
    });
  }
});

// Gửi đơn hàng ảo đến shipper
router.post('/shippers/:id/fake-order', verifyToken, isAdmin, async (req, res) => {
  try {
    const shipperId = req.params.id;
    
    // Tìm shipper
    const shipper = await User.findById(shipperId);
    if (!shipper) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Shipper không tồn tại' 
      });
    }
    
    // Kiểm tra FCM token
    if (!shipper.fcmToken) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Shipper chưa có FCM token' 
      });
    }
    
    // Tạo thông tin đơn hàng giả
    const fakeOrderId = 'FAKE-' + Math.floor(Math.random() * 10000);
    const fakeAddress = '123 Đường kiểm tra, Quận 1, TP.HCM';
    const fakeAmount = Math.floor(Math.random() * 500000) + 50000;
    
    // Gửi thông báo
    await sendPushNotification(
      shipper.fcmToken,
      `Đơn hàng mới #${fakeOrderId}`,
      `Giao đến: ${fakeAddress} - ${fakeAmount.toLocaleString('vi-VN')}đ`
    );
    
    res.json({ 
      status: 'success',
      message: 'Đã gửi thông báo đơn hàng ảo',
      order: {
        id: fakeOrderId,
        address: fakeAddress,
        amount: fakeAmount
      }
    });
  } catch (error) {
    console.error('Error sending fake order:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Lỗi server: ' + error.message
    });
  }
});

module.exports = router;
