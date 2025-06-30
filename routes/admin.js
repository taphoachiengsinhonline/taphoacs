// routes/admin.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const bcrypt = require('bcrypt');
const sendPushNotification = require('../utils/sendPushNotification');
const Product = require('../models/Product');

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
    // <<< SỬA ĐỔI: Lấy toàn bộ trường shipperProfile >>>
    const shippers = await User.find({ role: 'shipper' })
      .select(
        'name email address phone location locationUpdatedAt isAvailable shipperProfile' // Chỉ cần lấy cả object shipperProfile
      )
      .lean({ virtuals: true });
    // <<< KẾT THÚC SỬA ĐỔI >>>

    const nowVN = Date.now() + (7 * 60 * 60 * 1000);
    
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



router.put('/shippers/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const shipperId = req.params.id;
    const { name, email, phone, address, shipperProfile } = req.body;

    // Kiểm tra xem shipperProfile có tồn tại trong body không
    if (!shipperProfile) {
        return res.status(400).json({ message: 'Thiếu thông tin shipperProfile.' });
    }

    // <<< LOGIC SỬA ĐỔI QUAN TRỌNG >>>
    // Tạo một object update để chỉ cập nhật các trường có giá trị
    const updateData = {
        name,
        email,
        phone,
        address,
        // Sử dụng toán tử $set để cập nhật các trường lồng trong shipperProfile
        // Điều này đảm bảo các trường khác trong shipperProfile (như rating) không bị ghi đè
        $set: {
            'shipperProfile.vehicleType': shipperProfile.vehicleType,
            'shipperProfile.licensePlate': shipperProfile.licensePlate,
            'shipperProfile.shippingFeeShareRate': shipperProfile.shippingFeeShareRate,
            'shipperProfile.profitShareRate': shipperProfile.profitShareRate,
        }
    };
    // <<< KẾT THÚC SỬA ĐỔI >>>

    const updated = await User.findByIdAndUpdate(
      shipperId,
      updateData,
      { new: true, runValidators: true } // new: true để trả về document đã được cập nhật
    );

    if (!updated) {
      return res.status(404).json({ message: 'Không tìm thấy shipper' });
    }

    // Trả về dữ liệu đã được cập nhật để frontend có thể xác nhận
    res.json({
      status: 'success',
      data: updated
    });
  } catch (error) {
    console.error('Lỗi cập nhật shipper:', error);
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
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

// Lấy danh sách Sellers
router.get('/sellers', verifyToken, isAdmin, async (req, res) => {
    try {
        const sellers = await User.find({ role: 'seller' }).select('name email commissionRate');
        res.json(sellers);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// Cập nhật chiết khấu cho Seller
router.patch('/sellers/:sellerId/commission', verifyToken, isAdmin, async (req, res) => {
    try {
        const { commissionRate } = req.body;
        if (commissionRate === undefined || commissionRate < 0 || commissionRate > 100) {
            return res.status(400).json({ message: 'Chiết khấu không hợp lệ' });
        }
        const seller = await User.findByIdAndUpdate(
            req.params.sellerId,
            { commissionRate },
            { new: true }
        );
        if (!seller) return res.status(404).json({ message: 'Không tìm thấy seller' });
        res.json({ message: 'Cập nhật thành công', seller });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});



router.get('/products/pending/count', verifyToken, isAdmin, async (req, res) => {
    try {
        const count = await Product.countDocuments({ approvalStatus: 'pending_approval' });
        res.json({ count });
    } catch (error) {
        console.error('Lỗi đếm sản phẩm chờ duyệt:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
});





// Lấy sản phẩm chờ duyệt
router.get('/products/pending', verifyToken, isAdmin, async (req, res) => {
    try {
        const pendingProducts = await Product.find({ approvalStatus: 'pending_approval' }).populate('seller', 'name');
        res.json(pendingProducts);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// Phê duyệt sản phẩm
router.post('/products/:productId/approve', verifyToken, isAdmin, async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(req.params.productId, { approvalStatus: 'approved' }, { new: true });
        if (!product) return res.status(404).json({ message: 'Sản phẩm không tồn tại' });
        // (Tùy chọn) Gửi thông báo cho seller
        res.json({ message: 'Đã phê duyệt sản phẩm', product });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// Từ chối sản phẩm
router.post('/products/:productId/reject', verifyToken, isAdmin, async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ message: 'Cần có lý do từ chối' });
        const product = await Product.findByIdAndUpdate(req.params.productId, { approvalStatus: 'rejected', rejectionReason: reason }, { new: true });
        if (!product) return res.status(404).json({ message: 'Sản phẩm không tồn tại' });
        // (Tùy chọn) Gửi thông báo cho seller
        res.json({ message: 'Đã từ chối sản phẩm', product });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});





module.exports = router;
