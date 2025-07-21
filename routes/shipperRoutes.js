// routes/shipperRoutes.js

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin, protect, restrictTo } = require('../middlewares/authMiddleware');
const shipperController = require('../controllers/shipperController');
const orderController = require('../controllers/orderController');
const User = require('../models/User');
const bcrypt = require('bcrypt');

// ==========================================================
// ===         ROUTE DÀNH RIÊNG CHO ADMIN                   ===
// ==========================================================
// Route POST để tạo shipper mới (chỉ admin được dùng)
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { email, password, name, phone, address, shipperProfile } = req.body;
    const { vehicleType, licensePlate } = shipperProfile || {};
    if (!email || !password || !name || !phone || !address || !vehicleType || !licensePlate) {
      return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ thông tin' });
    }
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email đã tồn tại' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const shipper = new User({
      email, password: hashedPassword, name, phone, address, role: 'shipper',
      shipperProfile: { vehicleType, licensePlate }
    });
    await shipper.save();
    res.status(201).json({
      _id: shipper._id, email: shipper.email, role: shipper.role, shipperProfile: shipper.shipperProfile
    });
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});


// ==========================================================
// ===         CÁC ROUTE DÀNH RIÊNG CHO SHIPPER            ===
// ==========================================================
// Bảo vệ tất cả các route bên dưới, yêu cầu đăng nhập và có vai trò 'shipper'
router.use(protect, restrictTo('shipper'));

// --- Các route chức năng của shipper ---
router.post('/update-location', shipperController.updateLocation);
router.get('/assigned-orders', shipperController.getAssignedOrders);
router.put('/orders/:id/status', orderController.updateOrderStatusByShipper);
router.post('/orders/:id/accept', orderController.acceptOrder);
router.post('/orders/:id/add-surcharge', shipperController.addSurcharge);
router.get('/stats', shipperController.getShipperStats);
router.get('/order-counts', shipperController.getOrderCounts);

router.post('/update-fcm-token', shipperController.updateFcmToken);
router.post('/change-password', shipperController.changePassword);
router.get('/notifications', shipperController.getAllNotifications);
router.patch('/notifications/:id/read', shipperController.markNotificationAsRead);
router.delete('/notifications/:id', shipperController.deleteNotification);

// --- Các route báo cáo và tài chính ---
// Route cho HomeScreen để lấy dữ liệu nhanh trong ngày
router.get('/dashboard-summary', shipperController.getDashboardSummary);
// Route cho RevenueReportScreen để lấy báo cáo chi tiết theo tháng
router.get('/monthly-report', shipperController.getMonthlyFinancialReport);
// Route để shipper xác nhận đã nộp tiền
router.post('/remittance-request', shipperController.createRemittanceRequest);
router.post('/orders/:id/request-transfer', orderController.requestOrderTransfer);

module.exports = router;
