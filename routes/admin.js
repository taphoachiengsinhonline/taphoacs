// routes/admin.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const bcrypt = require('bcrypt');
const sendPushNotification = require('../utils/sendPushNotification');
const Product = require('../models/Product');
const Order = require('../models/Order'); // <<< THÊM
const Remittance = require('../models/Remittance'); // <<< THÊM
const moment = require('moment-timezone'); // <<< THÊM

// Middleware xác thực admin cho toàn bộ các route trong file này
router.use(verifyToken, isAdmin);

// ===============================================
// ===      QUẢN LÝ SHIPPER (Giữ nguyên)       ===
// ===============================================

// Tạo tài khoản shipper mới
router.post('/shippers', async (req, res) => {
    try {
        const { email, password, name, phone, address, shipperProfile } = req.body;
        const { vehicleType, licensePlate } = shipperProfile || {};
        if (!email || !password || !name || !phone || !address || !vehicleType || !licensePlate) {
            return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đầy đủ thông tin' });
        }
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ status: 'error', message: 'Email đã tồn tại' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const shipper = new User({
            email, password: hashedPassword, name, address, phone, role: 'shipper',
            shipperProfile: { vehicleType, licensePlate }
        });
        await shipper.save();
        res.status(201).json({ status: 'success', data: { _id: shipper._id, email: shipper.email, role: shipper.role, shipperProfile: shipper.shipperProfile } });
    } catch (error) {
        console.error('Error creating shipper:', error);
        res.status(500).json({ status: 'error', message: 'Lỗi server: ' + error.message });
    }
});

// Lấy danh sách shipper
router.get('/shippers', async (req, res) => {
    try {
        const shippers = await User.find({ role: 'shipper' }).select('name email address phone location locationUpdatedAt isAvailable shipperProfile').lean({ virtuals: true });
        const nowVN = Date.now() + (7 * 60 * 60 * 1000);
        const processedShippers = shippers.map(shipper => {
            const updatedAt = shipper.locationUpdatedAt?.getTime() || 0;
            const diff = nowVN - updatedAt;
            const isOnline = diff > 0 && diff <= 300000;
            return { ...shipper, isOnline, lastUpdateSeconds: Math.floor(diff / 1000) };
        });
        const onlineCount = processedShippers.filter(s => s.isOnline).length;
        res.json({ status: 'success', onlineCount, shippers: processedShippers });
    } catch (error) {
        console.error('Lỗi lấy danh sách shipper:', error);
        res.status(500).json({ status: 'error', message: 'Lỗi server: ' + error.message });
    }
});

// Cập nhật thông tin shipper
router.put('/shippers/:id', async (req, res) => {
    try {
        const shipperId = req.params.id;
        const { name, email, phone, address, shipperProfile } = req.body;
        if (!shipperProfile) {
            return res.status(400).json({ message: 'Thiếu thông tin shipperProfile.' });
        }
        const updateData = {
            name, email, phone, address,
            $set: {
                'shipperProfile.vehicleType': shipperProfile.vehicleType,
                'shipperProfile.licensePlate': shipperProfile.licensePlate,
                'shipperProfile.shippingFeeShareRate': shipperProfile.shippingFeeShareRate,
                'shipperProfile.profitShareRate': shipperProfile.profitShareRate,
            }
        };
        const updated = await User.findByIdAndUpdate(shipperId, updateData, { new: true, runValidators: true });
        if (!updated) return res.status(404).json({ message: 'Không tìm thấy shipper' });
        res.json({ status: 'success', data: updated });
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


// ===============================================
// ===   API MỚI: QUẢN LÝ CÔNG NỢ SHIPPER      ===
// ===============================================

// API để lấy danh sách tất cả các shipper và công nợ của họ
router.get('/shipper-debts', async (req, res) => {
    try {
        const shippers = await User.find({ role: 'shipper' }).select('name phone').lean();
        
        const debtData = await Promise.all(shippers.map(async (shipper) => {
            // Lấy tổng COD và tổng đã nộp của mỗi shipper
            const [codResult, remittedResult] = await Promise.all([
                Order.aggregate([
                    { $match: { shipper: shipper._id, status: 'Đã giao' } },
                    { $group: { _id: null, total: { $sum: '$total' } } }
                ]),
                Remittance.aggregate([
                    { $match: { shipper: shipper._id } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ])
            ]);

            const totalCOD = codResult[0]?.total || 0;
            const totalRemitted = remittedResult[0]?.total || 0;
            const totalDebt = totalCOD - totalRemitted;

            return {
                ...shipper,
                totalDebt: totalDebt > 0 ? totalDebt : 0,
            };
        }));
        
        // Sắp xếp shipper có nợ cao nhất lên đầu
        debtData.sort((a, b) => b.totalDebt - a.totalDebt);

        res.status(200).json(debtData);
    } catch (error) {
        console.error("[getShipperDebts] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
});

// API để đếm số shipper đang có công nợ (dùng cho badge)
router.get('/remittances/pending-count', async (req, res) => {
    try {
        const shippers = await User.find({ role: 'shipper' }).select('_id').lean();
        let pendingCount = 0;

        for (const shipper of shippers) {
            const [codResult, remittedResult] = await Promise.all([
                Order.aggregate([ { $match: { shipper: shipper._id, status: 'Đã giao' } }, { $group: { _id: null, total: { $sum: '$total' } } } ]),
                Remittance.aggregate([ { $match: { shipper: shipper._id } }, { $group: { _id: null, total: { $sum: '$amount' } } } ])
            ]);
            const totalDebt = (codResult[0]?.total || 0) - (remittedResult[0]?.total || 0);
            if (totalDebt > 0) {
                pendingCount++;
            }
        }
        res.status(200).json({ count: pendingCount });
    } catch (error) {
        console.error("[pending-count] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
});


// API lấy chi tiết các lần nộp tiền của một shipper
router.get('/remittances/:shipperId', async (req, res) => {
    try {
        const { shipperId } = req.params;
        const remittances = await Remittance.find({ shipper: shipperId }).sort({ remittanceDate: -1 });
        res.status(200).json(remittances);
    } catch (error) {
        console.error("[getShipperRemittances] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
});


module.exports = router;


module.exports = router;
