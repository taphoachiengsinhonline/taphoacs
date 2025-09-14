// File: backend/routes/reviewRoutes.js
const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Chỉ người dùng đã đăng nhập mới có thể tạo review
router.post('/', verifyToken, reviewController.createReview);

module.exports = router;
