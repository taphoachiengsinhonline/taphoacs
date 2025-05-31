// routes/admin.js
const router = require('express').Router();
const User = require('../models/User');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware'); // Thêm dòng này
const bcrypt = require('bcrypt');
router.post('/shippers', verifyToken, isAdmin, async (req, res) => {
  try {
    // Phân tích req.body, lấy shipperProfile
    const { email, password, name, phone, address, shipperProfile } = req.body;
    
    // Lấy vehicleType và licensePlate từ shipperProfile
    const { vehicleType, licensePlate } = shipperProfile || {};

    // Kiểm tra xem các trường bắt buộc có được cung cấp không
    if (!email || !password || !name || !phone || !address || !vehicleType || !licensePlate) {
      return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ thông tin' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email đã tồn tại' });
    }

    const shipper = new User({
      email,
      password,
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
      _id: shipper._id,
      email: shipper.email,
      role: shipper.role,
      shipperProfile: shipper.shipperProfile
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}); 

// Thêm endpoint gửi thông báo kiểm tra
router.post('/shippers/:id/test-notification', async (req, res) => {
  try {
    const shipper = await User.findById(req.params.id);
    if (!shipper) {
      return res.status(404).json({ message: 'Shipper không tồn tại' });
    }
    
    if (!shipper.fcmToken) {
      return res.status(400).json({ message: 'Shipper chưa có FCM token' });
    }
    
    // Gửi thông báo kiểm tra
    await sendPushNotification(
      shipper.fcmToken,
      'Kiểm tra thông báo',
      'Admin đang kiểm tra hệ thống thông báo'
    );
    
    res.json({ message: 'Đã gửi thông báo kiểm tra' });
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});



// Thêm endpoint gửi đơn hàng ảo
router.post('/shippers/:id/fake-order', async (req, res) => {
  try {
    const shipper = await User.findById(req.params.id);
    if (!shipper) {
      return res.status(404).json({ message: 'Shipper không tồn tại' });
    }
    
    if (!shipper.fcmToken) {
      return res.status(400).json({ message: 'Shipper chưa có FCM token' });
    }
    
    // Tạo thông báo đơn hàng giả
    const fakeOrderId = 'FAKE-' + Math.floor(Math.random() * 10000);
    const fakeAddress = '123 Đường kiểm tra, Quận 1, TP.HCM';
    const fakeAmount = Math.floor(Math.random() * 500000) + 50000;
    
    // Gửi thông báo
    await sendPushNotification(
      shipper.fcmToken,
      `Đơn hàng mới #${fakeOrderId}`,
      `Giao đến: ${fakeAddress} - ${fakeAmount.toLocaleString()}đ`
    );
    
    res.json({ 
      message: 'Đã gửi thông báo đơn hàng ảo',
      order: {
        id: fakeOrderId,
        address: fakeAddress,
        amount: fakeAmount
      }
    });
  } catch (error) {
    console.error('Error sending fake order:', error);
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});



// routes/admin.js
router.get('/shippers', async (req, res) => {
  try {
    const shippers = await User.find({ role: 'shipper' })
      .select('name email phone shipperProfile isAvailable location')
      .lean();
    
    // Format location data
    const formattedShippers = shippers.map(shipper => {
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

    res.json(formattedShippers);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});


router.get('/shippers', async (req, res) => {
  try {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);
    
    // Lấy tất cả shipper
    const allShippers = await User.find({ role: 'shipper' })
      .select('name email phone shipperProfile location locationUpdatedAt')
      .lean();
    
    // Đánh dấu shipper online
    const shippersWithStatus = allShippers.map(shipper => ({
      ...shipper,
      isOnline: shipper.locationUpdatedAt && 
               new Date(shipper.locationUpdatedAt) >= fiveMinutesAgo
    }));
    
    // Đếm số lượng online
    const onlineCount = shippersWithStatus.filter(s => s.isOnline).length;
    
    res.json({
      onlineCount,
      shippers: shippersWithStatus
    });
  } catch (error) {
    console.error('Error fetching shippers:', error);
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});





module.exports = router;
