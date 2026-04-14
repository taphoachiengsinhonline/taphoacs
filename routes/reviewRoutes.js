// File: backend/routes/reviewRoutes.js
const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Chỉ người dùng đã đăng nhập mới có thể tạo review
router.get('/product/:productId', reviewController.getReviewsForProduct);
// <<< ROUTE MỚI >>>
router.get('/status/:orderId', verifyToken, reviewController.getReviewStatusForOrder);
router.post('/', verifyToken, reviewController.createReview);

router.get('/stats/:targetType/:targetId', reviewController.getRatingStats);
router.get('/rating-stats/:targetType/:targetId', reviewController.getRatingStats);
router.get('/shipper/:shipperId', reviewController.getReviewsForShipper);
router.get('/seller/:sellerId', reviewController.getReviewsForSeller);

module.exports = router;
