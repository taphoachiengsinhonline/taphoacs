// File: backend/routes/shipperRoutes.js

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const shipperController = require('../controllers/shipperController');

// Middleware: Yêu cầu tất cả các route trong file này đều phải đăng nhập với vai trò shipper
router.use(verifyToken);

// ===============================================
// === DASHBOARD & THỐNG KÊ ===
// ===============================================
router.get('/dashboard-summary', shipperController.getDashboardSummary);
router.get('/stats', shipperController.getShipperStats);
router.get('/order-counts', shipperController.getOrderCounts);

// ===============================================
// === QUẢN LÝ ĐƠN HÀNG ===
// ===============================================
// Lấy danh sách đơn hàng đã gán (có filter và pagination)
router.get('/orders', shipperController.getAssignedOrders);

// Thêm phụ phí vào một đơn hàng cụ thể
router.post('/orders/:id/surcharge', shipperController.addSurcharge);


// ===============================================
// === QUẢN LÝ THÔNG BÁO ===
// ===============================================
router.get('/notifications', shipperController.getAllNotifications);
router.get('/notifications/unread-count', shipperController.getUnreadNotificationCount);
router.patch('/notifications/:id/read', shipperController.markNotificationAsRead);
router.delete('/notifications/:id', shipperController.deleteNotification);


// ===============================================
// === TÀI CHÍNH & ĐỐI SOÁT ===
// ===============================================
// Gửi yêu cầu xác nhận nộp tiền COD
router.post('/remittance-request', shipperController.createRemittanceRequest);

// Lấy báo cáo tài chính theo tháng
router.get('/financial-report', shipperController.getMonthlyFinancialReport);


// ===============================================
// === QUẢN LÝ TÀI KHOẢN & CÀI ĐẶT ===
// ===============================================
// Cập nhật vị trí hiện tại của shipper
router.post('/update-location', shipperController.updateLocation);

// Cập nhật FCM token để nhận push notification
router.post('/update-fcm-token', shipperController.updateFcmToken);

// Đổi mật khẩu
router.post('/change-password', shipperController.changePassword);

// --- Luồng cập nhật thông tin thanh toán qua OTP Email ---
// Bước 1: Yêu cầu gửi OTP
router.post('/me/payment-info/request-update', shipperController.requestUpdatePaymentInfo);

// Bước 2: Xác thực OTP và cập nhật
router.post('/me/payment-info/verify-update', shipperController.verifyUpdatePaymentInfo);


module.exports = router;
