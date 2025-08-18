// routes/sellerOrderRoutes.js
const express = require('express');
const router = express.Router();
const sellerOrderController = require('../controllers/sellerOrderController');
const { verifyToken, isSeller } = require('../middlewares/authMiddleware');

router.use(verifyToken, isSeller);

// Seller lấy danh sách các đơn hàng cần tư vấn
router.get('/consultation-requests', sellerOrderController.getConsultationRequests);

// Seller cập nhật và báo giá cho một đơn hàng
router.put('/:id/price-and-update', sellerOrderController.priceAndUpdateOrder);

module.exports = router;
