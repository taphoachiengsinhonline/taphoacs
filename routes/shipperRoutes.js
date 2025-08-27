// File: backend/routes/shipperRoutes.js

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const shipperController = require('../controllers/shipperController'); // Đảm bảo import đúng

// Middleware: Yêu cầu tất cả route trong file này phải đăng nhập
router.use(verifyToken);

// ===============================================
// === CÁC ROUTE CŨ CỦA BẠN - GIỮ NGUYÊN ===
// ===============================================
router.post('/update-location', shipperController.updateLocation);
router.get('/orders', shipperController.getAssignedOrders);
router.get('/stats', shipperController.getShipperStats);
router.get('/order-counts', shipperController.getOrderCounts);
router.post('/orders/:id/surcharge', shipperController.addSurcharge);
router.post('/update-fcm-token', shipperController.updateFcmToken);
router.post('/change-password', shipperController.changePassword);
router.get('/notifications', shipperController.getAllNotifications);
router.patch('/notifications/:id/read', shipperController.markNotificationAsRead);
router.delete('/notifications/:id', shipperController.deleteNotification);
router.get('/dashboard-summary', shipperController.getDashboardSummary);
router.post('/remittance-request', shipperController.createRemittanceRequest);
router.get('/financial-report', shipperController.getMonthlyFinancialReport);
router.get('/notifications/unread-count', shipperController.getUnreadNotificationCount);

// ===============================================
// === ROUTE CẬP NHẬT THÔNG TIN THANH TOÁN (ĐÃ SỬA) ===
// ===============================================

// Bước 1: Client gửi thông tin mới để yêu cầu OTP
router.post('/me/payment-info/request-update', shipperController.requestUpdatePaymentInfo);

// Bước 2: Client gửi OTP để xác thực và hoàn tất cập nhật
router.post('/me/payment-info/verify-update', shipperController.verifyUpdatePaymentInfo);

// Route PUT cũ này có thể không còn cần thiết nếu bạn đã chuyển hoàn toàn sang OTP.
// Tuy nhiên, để sửa lỗi "got [object Undefined]", hãy chắc chắn rằng
// hàm `shipperController.updatePaymentInfo` tồn tại và đã được export.
// Hoặc bạn có thể xóa/comment dòng này đi nếu không dùng nữa.
router.put('/me/payment-info', shipperController.updatePaymentInfo);


module.exports = router;
