// File: routes/authRoutes.js

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const Region = require('../models/Region');

// Import các controller đã được tách
const authController = require('../controllers/authController');
const registrationController = require('../controllers/registrationController');

// --- CÁC ROUTE VỀ XÁC THỰC ---
router.post('/login', authController.login);
router.post('/refresh-token', authController.refreshToken);
router.get('/me', verifyToken, authController.getMe);

// --- CÁC ROUTE VỀ ĐĂNG KÝ ---
// Đăng ký chung (customer, shipper, etc.)
router.post('/register', registrationController.registerUser);
// Đăng ký chuyên biệt cho Seller
router.post('/register/seller', registrationController.registerSeller);

// --- ROUTE TIỆN ÍCH (không cần xác thực) ---
// API này không cần xác thực, ai cũng có thể gọi để xem các vùng hoạt động
router.get('/regions', async (req, res) => {
    try {
        const activeRegions = await Region.find({ isActive: true }).select('name _id');
        res.status(200).json(activeRegions);
    } catch (error) {
        res.status(500).json({ message: "Lỗi server khi lấy danh sách khu vực." });
    }
});

module.exports = router;
