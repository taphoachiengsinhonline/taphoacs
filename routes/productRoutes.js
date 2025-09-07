// File: backend/routes/productRoutes.js
const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { verifyToken, optionalAuth } = require('../middlewares/authMiddleware'); // Import cả verifyToken và optionalAuth

// --- Routes công khai hoặc có điều kiện (dùng optionalAuth) ---
router.get('/', optionalAuth, productController.getAllProducts);
router.get('/bestsellers', optionalAuth, productController.getBestSellers);

// --- Sửa dùng optionalAuth để hỗ trợ khách vãng lai ---
router.get('/:id/recommendations', verifyToken, productController.getProductRecommendations);

// --- Routes yêu cầu đăng nhập bắt buộc (dùng verifyToken) ---
router.get('/:id', productController.getProductById); // Công khai, không cần verifyToken
router.post('/', verifyToken, productController.createProduct);
router.put('/:id', verifyToken, productController.updateProduct);
router.delete('/:id', verifyToken, productController.deleteProduct);

module.exports = router;
