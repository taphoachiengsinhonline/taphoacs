// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect } = require('../middlewares/authMiddleware'); // Sử dụng protect cho tất cả

// Middleware: Áp dụng `protect` cho tất cả các route bên dưới
router.use(protect); 

// === QUẢN LÝ THÔNG TIN USER ===
router.put('/:id', userController.updateUserProfile);
router.post('/change-password', userController.changePassword);
router.post('/update-location', userController.updateLocation);
router.post('/update-fcm-token', userController.updateFcmToken);

// === QUẢN LÝ THÔNG BÁO ===
router.get('/notifications', userController.getUserNotifications);
router.get('/notifications/unread-count', userController.getUnreadNotificationCount);
router.patch('/notifications/:id/read', userController.markNotificationAsRead);
router.delete('/notifications/:id', userController.deleteNotification);

// === GỢI Ý CÁ NHÂN HÓA ===
router.get('/me/recommendations', userController.getPersonalizedRecommendations);
router.get('/seller-profile/:sellerId', userController.getSellerPublicProfile);
module.exports = router;
