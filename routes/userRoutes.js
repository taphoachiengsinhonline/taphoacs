// routes/userRoutes.js

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
// Cập nhật thông tin user (cần `protect` để biết đang cập nhật cho ai)
router.put('/:id', userController.updateUserProfile);
router.put('/me/avatar', userController.updateAvatar);

// Đổi mật khẩu (cần `protect` để biết ai đang đổi mật khẩu)
router.post('/change-password', userController.changePassword);

// Cập nhật vị trí (cần `protect` để biết vị trí của ai)
router.post('/update-location', userController.updateLocation);

// Cập nhật FCM token (cần `protect` để biết cập nhật token cho ai)
router.post('/update-fcm-token', userController.updateFcmToken);

// === QUẢN LÝ THÔNG BÁO (Tất cả đều cần `protect`) ===
router.get('/notifications', userController.getUserNotifications);
router.get('/notifications/unread-count', userController.getUnreadNotificationCount);
router.patch('/notifications/:id/read', userController.markNotificationAsRead);
router.delete('/notifications/:id', userController.deleteNotification);

// === GỢI Ý CÁ NHÂN HÓA (Cần `protect` để biết "cá nhân" là ai) ===
router.get('/me/recommendations', userController.getPersonalizedRecommendations);


module.exports = router;
