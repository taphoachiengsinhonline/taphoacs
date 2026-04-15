// File: backend/routes/reviewRoutes.js
const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.use((req, res, next) => {
    console.log(`[REVIEW ROUTER] ${req.method} ${req.originalUrl}`);
    next();
});

// Routes cụ thể (không tham số hoặc tham số cố định)
router.get('/product/:productId', reviewController.getReviewsForProduct);
router.get('/shipper/:shipperId', reviewController.getReviewsForShipper);
router.get('/seller/:sellerId', reviewController.getReviewsForSeller);
router.get('/order/:orderId', verifyToken, reviewController.getOrderReviews); // ĐẶT Ở ĐÂY

// Routes có tham số chung
router.get('/status/:orderId', verifyToken, reviewController.getReviewStatusForOrder);
router.get('/stats/:targetType/:targetId', reviewController.getRatingStats);
router.get('/rating-stats/:targetType/:targetId', reviewController.getRatingStats);
router.post('/', verifyToken, reviewController.createReview);
router.patch('/:reviewId/reply', verifyToken, reviewController.replyToReview);

module.exports = router;
