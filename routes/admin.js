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

// FIX: Sửa hoàn toàn logic xác định online status
router.get('/shippers', async (req, res) => {
  try {
    const now = Date.now(); // Sử dụng timestamp để chính xác
    const fiveMinutesAgo = new Date(now - 5 * 60000);
    
    // Lấy tất cả shipper từ database
    const allShippers = await User.find({ role: 'shipper' })
      .select('name email phone shipperProfile location locationUpdatedAt fcmToken isAvailable')
      .lean();
    
    // FIX: Logic xác định online hoàn toàn mới
    const shippersWithStatus = allShippers.map(shipper => {
      // Kiểm tra điều kiện online
      const locationUpdatedAt = shipper.locationUpdatedAt 
        ? new Date(shipper.locationUpdatedAt)
        : null;
      
      const isOnline = locationUpdatedAt && locationUpdatedAt >= fiveMinutesAgo;
      
      return {
        ...shipper,
        isOnline
      };
    });
    
    const onlineCount = shippersWithStatus.filter(s => s.isOnline).length;
    
    // Format dữ liệu vị trí cho client
    const formattedShippers = shippersWithStatus.map(shipper => {
      if (shipper.location && shipper.location.coordinates) {
        return {
          ...shipper,
          location: {
            coordinates: [
              shipper.location.coordinates[0],
              shipper.location.coordinates[1]
            ]
          }
        };
      }
      return shipper;
    });

    // FIX: Log debug chi tiết
    console.log('==== SHIPPER STATUS DEBUG ====');
    console.log(`Thời gian hiện tại: ${new Date(now)}`);
    console.log(`Thời gian 5 phút trước: ${fiveMinutesAgo}`);
    formattedShippers.forEach((s, i) => {
      console.log(`\nShipper ${i+1}: ${s.name || s.email}`);
      console.log(`- Location Updated: ${s.locationUpdatedAt || 'Chưa cập nhật'}`);
      console.log(`- isOnline: ${s.isOnline}`);
      if (s.locationUpdatedAt) {
        const diffMinutes = Math.floor((now - new Date(s.locationUpdatedAt).getTime()) / 60000;
        console.log(`- Cập nhật cách đây: ${diffMinutes.toFixed(2)} phút`);
      }
    });
    console.log('==============================');

    res.json({
      status: 'success',
      onlineCount,
      shippers: formattedShippers
    });
  } catch (error) {
    console.error('Error fetching shippers:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Lỗi server: ' + error.message
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



// Thêm đoạn này trước khi trả response
console.log('==== DEBUG SHIPPER STATUS ====');
console.log(`Thời gian hiện tại: ${new Date()}`);
console.log(`Thời gian 5 phút trước: ${fiveMinutesAgo}`);

formattedShippers.forEach((s, i) => {
  console.log(`\nShipper ${i + 1}: ${s.name || s.email}`);
  console.log(`- ID: ${s._id}`);
  console.log(`- Location Updated: ${s.locationUpdatedAt || 'Chưa cập nhật'}`);
  console.log(`- isAvailable: ${s.isAvailable}`);
  console.log(`- Online Status: ${s.isOnline ? 'ONLINE' : 'OFFLINE'}`);
  
  if (s.locationUpdatedAt) {
    const lastUpdate = new Date(s.locationUpdatedAt);
    const diffMinutes = Math.floor((new Date() - lastUpdate) / 60000);
    console.log(`- Last update: ${diffMinutes} phút trước`);
  }
});

console.log('==============================');





    
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
