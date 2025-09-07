// File: backend/routes/productRoutes.js

const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { verifyToken, optionalAuth } = require('../middlewares/authMiddleware');

// --- Routes công khai hoặc có điều kiện (dùng optionalAuth) ---
router.get('/', optionalAuth, productController.getAllProducts);
router.get('/bestsellers', optionalAuth, productController.getBestSellers);

// --- Routes yêu cầu đăng nhập bắt buộc (dùng verifyToken) ---
router.get('/:productId/related', verifyToken, productController.getRelatedProducts);
router.get('/:productId/also-bought', verifyToken, productController.getAlsoBoughtProducts);

// --- Routes khác ---
router.get('/:id', productController.getProductById); // Chi tiết sản phẩm công khai
router.post('/', verifyToken, productController.createProduct);
router.put('/:id', verifyToken, productController.updateProduct);
router.delete('/:id', verifyToken, productController.deleteProduct);

module.exports = router;
