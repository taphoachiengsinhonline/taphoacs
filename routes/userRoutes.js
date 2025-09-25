const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect } = require('../middlewares/authMiddleware'); // Sử dụng protect

// =======================================================
// === ROUTE CÔNG KHAI (Public Route)                  ===
// === Route này KHÔNG cần đăng nhập. Đặt ở trên cùng. ===
// =======================================================

// Lấy thông tin công khai của một seller để hiển thị trang cửa hàng
// Bất kỳ ai cũng có thể gọi API này.
router.get('/seller-profile/:sellerId', userController.getSellerPublicProfile);

// =======================================================
// === CÁC ROUTE BẢO MẬT (Protected Routes)           ===
// === Middleware `protect` sẽ được áp dụng cho tất cả các route bên dưới đây ===
// =======================================================
router.use(protect);

// === QUẢN LÝ THÔNG TIN USER ===
router.put('/:id', userController.updateUserProfile);
router.post('/status', userController.updateUserStatus); // Sử dụng protect từ router.use
router.put('/me/avatar', userController.updateAvatar);

// Đổi mật khẩu
router.post('/change-password', userController.changePassword);

// Cập nhật vị trí
router.post('/update-location', userController.updateLocation);

// Cập nhật FCM token
router.post('/update-fcm-token', userController.updateFcmToken);

// === QUẢN LÝ THÔNG BÁO ===
router.get('/notifications', userController.getUserNotifications);
router.get('/notifications/unread-count', userController.getUnreadNotificationCount);
router.patch('/notifications/:id/read', userController.markNotificationAsRead);
router.delete('/notifications/:id', userController.deleteNotification);

// === GỢI Ý CÁ NHÂN HÓA ===
router.get('/me/recommendations', userController.getPersonalizedRecommendations);
router.put('/me/region', verifyToken, userController.updateUserRegion);
module.exports = router;
