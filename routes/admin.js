// routes/admin.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const { verifyRegionManager } = require('../middlewares/regionAuthMiddleware');
const bcrypt = require('bcrypt');
const Product = require('../models/Product');

// <<< BƯỚC 1: SỬA LẠI IMPORT >>>
// Bỏ import cũ, thay bằng import `safeNotify`
const { safeNotify } = require('../utils/notificationMiddleware');

// Import controller
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
      return res.status(400).json({ status: 'error', message: 'Shipper này hiện chưa có token để nhận thông báo.' });
    }

    // <<< BƯỚC 2: SỬA LẠI HÀM GỌI Ở ĐÂY >>>
    await safeNotify(shipper.fcmToken, {
        title: 'Kiểm tra thông báo', 
        body: 'Admin đang kiểm tra hệ thống thông báo của bạn.',
        data: { type: 'test_notification' } // Gửi kèm data để app có thể xử lý nếu cần
    });

    res.json({ status: 'success', message: 'Đã gửi yêu cầu gửi thông báo kiểm tra' });
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
      return res.status(400).json({ status: 'error', message: 'Shipper này hiện chưa có token để nhận thông báo.' });
    }
    const fakeOrderId = 'FAKE-' + Math.floor(Math.random() * 10000);
    const fakeAddress = '123 Đường kiểm tra, Quận 1, TP.HCM';
    const fakeAmount = Math.floor(Math.random() * 500000) + 50000;
    
    // <<< BƯỚC 3: SỬA LẠI HÀM GỌI Ở ĐÂY >>>
    await safeNotify(shipper.fcmToken, {
        title: `Đơn hàng mới #${fakeOrderId}`, 
        body: `Giao đến: ${fakeAddress} - ${fakeAmount.toLocaleString('vi-VN')}đ`,
        // Gửi data giống hệt một đơn hàng thật để app có thể hiển thị modal
        data: {
          orderId: fakeOrderId,
          notificationType: 'newOrderModal',
          distance: (Math.random() * 5).toFixed(2), // Khoảng cách ngẫu nhiên
          shipperView: "true"
        }
    });

    res.json({ status: 'success', message: 'Đã gửi thông báo đơn hàng ảo', order: { id: fakeOrderId, address: fakeAddress, amount: fakeAmount } });
  } catch (error) {
    console.error('Error sending fake order:', error);
    res.status(500).json({ status: 'error', message: 'Lỗi server: ' + error.message });
  }
});

// ===============================================
// ===      QUẢN LÝ SELLER (Giữ nguyên)        ===
// ===============================================
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
// === CÁC ROUTE TRỎ TỚI CONTROLLER (Giữ nguyên) ===
// =======================================================

router.get('/shipper-debt-overview', adminController.getShipperDebtOverview);
router.get('/remittances/pending-count', adminController.countPendingRemittanceRequests);
router.patch('/remittance-request/:requestId/process', adminController.processRemittanceRequest);
router.get('/shipper-financial-overview', adminController.getShipperFinancialOverview);
router.get('/shippers/:shipperId/financial-details', adminController.getShipperFinancialDetails);
router.get('/shippers/:shipperId/comprehensive-financials', adminController.getShipperComprehensiveFinancials);
router.post('/shippers/:shipperId/pay-salary', adminController.payShipperSalary);
router.get('/seller-financial-overview', adminController.getSellerFinancialOverview);
router.get('/sellers/:sellerId/comprehensive-financials', adminController.getSellerComprehensiveFinancials);
router.post('/sellers/:sellerId/pay', adminController.payToSeller);
router.get('/all-pending-counts', adminController.getAllPendingCounts);
router.get('/sellers/pending', adminController.getPendingSellers);
router.post('/sellers/:sellerId/approve', adminController.approveSeller);
router.post('/sellers/:sellerId/reject', adminController.rejectSeller);
router.get('/financial-overview', adminController.getFinancialOverview);
router.get('/dashboard-counts', adminController.getAdminDashboardCounts);
router.post('/shippers/:shipperId/remind-debt', adminController.remindShipperToPayDebt);
router.get('/sellers', verifyToken, verifyRegionManager, adminController.getAllSellers);
// <<< BẮT ĐẦU THÊM ROUTE CHO QUẢN LÝ VÙNG >>>
router.get('/region-managers', verifyToken, verifyAdmin, adminController.getRegionManagers);
router.post('/region-managers', verifyToken, verifyAdmin, adminController.createRegionManager);
router.put('/region-managers/:managerId', verifyToken, verifyAdmin, adminController.updateRegionManager);
router.put('/users/:userId/assign-manager', verifyToken, verifyAdmin, adminController.assignManagerToUser);
// <<< KẾT THÚC THÊM ROUTE >>>

module.exports = router;
