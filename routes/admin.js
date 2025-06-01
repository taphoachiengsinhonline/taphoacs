// routes/admin.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const bcrypt = require('bcrypt');
const sendPushNotification = require('../utils/sendPushNotification');

router.get('/ping', (req, res) => {
  console.log('[LOG] Đã chạm vào GET /admin/ping');
  return res.json({ status: 'pong' });
});

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

router.get('/shippers', async (req, res) => {
  try {
    const now = Date.now();
    const sevenHours = 7 * 60 * 60 * 1000; // 7h tính bằng ms
    const nowVN = Date.now() + sevenHours;
    
    // FIX: Sử dụng Mongoose để lấy dữ liệu đầy đủ
    const shippers = await User.find({ role: 'shipper' })
  .select(
    'name email address phone location locationUpdatedAt isAvailable ' +
    'shipperProfile.vehicleType shipperProfile.licensePlate'
  )
  .lean({ virtuals: true });

    // FIX: Tính toán trạng thái online
    const processedShippers = shippers.map(shipper => {
      const updatedAt = shipper.locationUpdatedAt?.getTime() || 0;
      const diff = nowVN - updatedAt;
      const isOnline = diff > 0 && diff <= 300000; // 5 phút
      
      return {
        ...shipper,
        isOnline,
        lastUpdateSeconds: Math.floor(diff / 1000)
      };
    });
    
    const onlineCount = processedShippers.filter(s => s.isOnline).length;

    // FIX: Log debug đơn giản nhưng hiệu quả
    console.log('==== SHIPPER STATUS ====');
    console.log(`Tổng shipper: ${processedShippers.length}`);
    console.log(`Online: ${onlineCount}`);
    console.log('Chi tiết:');
    
    processedShippers.forEach(s => {
      const status = s.isOnline ? '🟢 ONLINE' : '🔴 OFFLINE';
      const lastUpdate = s.locationUpdatedAt 
        ? new Date(s.locationUpdatedAt).toISOString() 
        : 'Chưa cập nhật';
      console.log(`- ${s.name}: ${status}, Cập nhật: ${lastUpdate}`);
    });
    
    console.log('=======================');

    res.json({
      status: 'success',
      onlineCount,
      shippers: processedShippers
    });
  } catch (error) {
    console.error('Lỗi lấy danh sách shipper:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Lỗi server: ' + error.message
    });
  }
});



router.put(
  '/shippers/:id',
  //verifyToken,
  //isAdmin,
  (req, res, next) => {
    console.log('[LOG] Đã chạm vào route PUT /admin/shippers/:id với id =', req.params.id);
    next();
  },
  async (req, res) => {
    try {
      const shipperId = req.params.id;
      // … phần cập nhật
    } catch (error) {
      console.error('Lỗi cập nhật shipper:', error);
      res.status(500).json({ message: 'Lỗi server: ' + error.message });
    }
  }
);





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
    
    // Gửi thông báo push
    await sendPushNotification(
      shipper.fcmToken,
      `Đơn hàng mới #${fakeOrderId}`,
      `Giao đến: ${fakeAddress} - ${fakeAmount.toLocaleString('vi-VN')}đ`
    );

    // **Đã loại bỏ khối debug gây lỗi fiveMinutesAgo & formattedShippers**

    // Trả về kết quả thành công
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
