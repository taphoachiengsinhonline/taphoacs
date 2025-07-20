// routes/admin.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const bcrypt = require('bcrypt');
const sendPushNotification = require('../utils/sendPushNotification');
const Product = require('../models/Product');

// <<< BƯỚC 1: IMPORT CONTROLLER >>>
// Tất cả logic xử lý sẽ được gọi từ đây
const adminController = require('../controllers/adminController');

// Middleware: Yêu cầu tất cả các route trong file này phải là admin đã đăng nhập
router.use(verifyToken, isAdmin);

// ===============================================
// ===      QUẢN LÝ SHIPPER                   ===
// ===============================================

// Tạo tài khoản shipper mới
router.post('/shippers', async (req, res) => {
    try {
        const { email, password, name, phone, address, shipperProfile } = req.body;
        const { vehicleType, licensePlate, shippingFeeShareRate, profitShareRate } = shipperProfile || {};
        if (!email || !password || !name || !phone || !address || !vehicleType || !licensePlate) {
            return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đầy đủ thông tin' });
        }
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ status: 'error', message: 'Email đã tồn tại' });
        }
        //const hashedPassword = await bcrypt.hash(password, 10);
        const shipper = new User({
            email, password: password, name, address, phone, role: 'shipper',
            shipperProfile: { vehicleType, licensePlate, shippingFeeShareRate, profitShareRate }
        });
        await shipper.save();
        res.status(201).json({ status: 'success', data: shipper });
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
router.post('/shippers/:id/test-notification', async (req, res) => {
  try {
    const shipperId = req.params.id;
    const shipper = await User.findById(shipperId);
    if (!shipper) {
      return res.status(404).json({ status: 'error', message: 'Shipper không tồn tại' });
    }
    if (!shipper.fcmToken) {
      return res.status(400).json({ status: 'error', message: 'Shipper chưa có FCM token' });
    }
    await sendPushNotification(shipper.fcmToken, 'Kiểm tra thông báo', 'Admin đang kiểm tra hệ thống thông báo');
    res.json({ status: 'success', message: 'Đã gửi thông báo kiểm tra' });
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({ status: 'error', message: 'Lỗi server: ' + error.message });
  }
});

// Gửi đơn hàng ảo đến shipper
router.post('/shippers/:id/fake-order', async (req, res) => {
  try {
    const shipperId = req.params.id;
    const shipper = await User.findById(shipperId);
    if (!shipper) {
      return res.status(404).json({ status: 'error', message: 'Shipper không tồn tại' });
    }
    if (!shipper.fcmToken) {
      return res.status(400).json({ status: 'error', message: 'Shipper chưa có FCM token' });
    }
    const fakeOrderId = 'FAKE-' + Math.floor(Math.random() * 10000);
    const fakeAddress = '123 Đường kiểm tra, Quận 1, TP.HCM';
    const fakeAmount = Math.floor(Math.random() * 500000) + 50000;
    await sendPushNotification(shipper.fcmToken, `Đơn hàng mới #${fakeOrderId}`, `Giao đến: ${fakeAddress} - ${fakeAmount.toLocaleString('vi-VN')}đ`);
    res.json({ status: 'success', message: 'Đã gửi thông báo đơn hàng ảo', order: { id: fakeOrderId, address: fakeAddress, amount: fakeAmount } });
  } catch (error) {
    console.error('Error sending fake order:', error);
    res.status(500).json({ status: 'error', message: 'Lỗi server: ' + error.message });
  }
});

// ===============================================
// ===      QUẢN LÝ SELLER (Giữ nguyên)        ===
// ===============================================
router.get('/sellers', async (req, res) => {
    try {
        const sellers = await User.find({ role: 'seller' }).select('name email commissionRate');
        res.json(sellers);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});
router.patch('/sellers/:sellerId/commission', async (req, res) => {
    try {
        const { commissionRate } = req.body;
        if (commissionRate === undefined || commissionRate < 0 || commissionRate > 100) {
            return res.status(400).json({ message: 'Chiết khấu không hợp lệ' });
        }
        const seller = await User.findByIdAndUpdate(req.params.sellerId, { commissionRate }, { new: true });
        if (!seller) return res.status(404).json({ message: 'Không tìm thấy seller' });
        res.json({ message: 'Cập nhật thành công', seller });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// ===============================================
// ===      QUẢN LÝ SẢN PHẨM (Giữ nguyên)     ===
// ===============================================
router.get('/products/pending/count', async (req, res) => {
    try {
        const count = await Product.countDocuments({ approvalStatus: 'pending_approval' });
        res.json({ count });
    } catch (error) {
        console.error('Lỗi đếm sản phẩm chờ duyệt:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
});
router.get('/products/pending', async (req, res) => {
    try {
        const pendingProducts = await Product.find({ approvalStatus: 'pending_approval' }).populate('seller', 'name');
        res.json(pendingProducts);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});
router.post('/products/:productId/approve', async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(req.params.productId, { approvalStatus: 'approved' }, { new: true });
        if (!product) return res.status(404).json({ message: 'Sản phẩm không tồn tại' });
        res.json({ message: 'Đã phê duyệt sản phẩm', product });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});
router.post('/products/:productId/reject', async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ message: 'Cần có lý do từ chối' });
        const product = await Product.findByIdAndUpdate(req.params.productId, { approvalStatus: 'rejected', rejectionReason: reason }, { new: true });
        if (!product) return res.status(404).json({ message: 'Sản phẩm không tồn tại' });
        res.json({ message: 'Đã từ chối sản phẩm', product });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// =======================================================
// === <<< BƯỚC 2: DỌN DẸP VÀ TRỎ ROUTE ĐẾN CONTROLLER >>> ===
// =======================================================

// Route CŨ, bây giờ trỏ đến controller
router.get('/shipper-debt-overview', adminController.getShipperDebtOverview);

// Route CŨ, bây giờ trỏ đến controller
router.get('/remittances/pending-count', adminController.countPendingRemittanceRequests);

// Route CŨ, bây giờ trỏ đến controller
router.patch('/remittance-request/:requestId/process', adminController.processRemittanceRequest);


// --- CÁC ROUTE MỚI CHO CHỨC NĂNG TRẢ LƯƠNG ---

// Lấy tổng quan tài chính (Công nợ & Lương) của tất cả shipper
// **MÀN HÌNH "Công nợ & Lương Shipper" SẼ GỌI ROUTE NÀY**
router.get('/shipper-financial-overview', adminController.getShipperFinancialOverview);

// Admin lấy chi tiết tài chính của 1 shipper theo tháng
// **MÀN HÌNH "Đối soát tài chính Shipper" SẼ GỌI ROUTE NÀY**
router.get('/shippers/:shipperId/financial-details', adminController.getShipperFinancialDetails);
router.get('/shippers/:shipperId/comprehensive-financials', adminController.getShipperComprehensiveFinancials);

// Admin trả lương cho shipper
// **NÚT "TRẢ LƯƠNG" TRONG MODAL SẼ GỌI ROUTE NÀY**
router.post('/shippers/:shipperId/pay-salary', adminController.payShipperSalary);
router.get('/shipper-financial-overview', adminController.getShipperFinancialOverview);

// Lấy tổng quan tài chính của tất cả Seller
router.get('/seller-financial-overview', adminController.getSellerFinancialOverview);

// Lấy chi tiết đối soát của 1 Seller theo tháng
router.get('/sellers/:sellerId/financial-details', adminController.getSellerFinancialDetails);

router.get('/all-pending-counts', adminController.getAllPendingCounts);
router.get('/sellers/pending', adminController.getPendingSellers);
router.post('/sellers/:sellerId/approve', adminController.approveSeller);
router.post('/sellers/:sellerId/reject', adminController.rejectSeller);

module.exports = router;
