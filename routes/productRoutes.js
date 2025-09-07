const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { optionalAuth } = require('../middlewares/authMiddleware'); // Sửa dùng optionalAuth

// --- Routes công khai hoặc có điều kiện (dùng optionalAuth) ---
router.get('/', optionalAuth, productController.getAllProducts);
router.get('/bestsellers', optionalAuth, productController.getBestSellers);

// --- Sửa dùng optionalAuth để hỗ trợ khách vãng lai ---
router.get('/:productId/related', optionalAuth, productController.getRelatedProducts);
router.get('/:productId/also-bought', optionalAuth, productController.getAlsoBoughtProducts);

// --- Routes khác ---
router.get('/:id', productController.getProductById); // Công khai
router.post('/', verifyToken, productController.createProduct);
router.put('/:id', verifyToken, productController.updateProduct);
router.delete('/:id', verifyToken, productController.deleteProduct);

module.exports = router;
