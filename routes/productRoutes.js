// backend/routes/productRoutes.js

const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { verifyToken } = require('../middlewares/authMiddleware');

// === CÁC ROUTE CỤ THỂ (phải đặt trước route động /:id) ===

// Lấy sản phẩm bán chạy nhất
router.get('/bestsellers', productController.getBestSellers);

// Lấy sản phẩm bán chạy nhất - Cần token để biết khu vực
router.get('/bestsellers', verifyToken, productController.getBestSellers);

// Lấy sản phẩm liên quan (cùng danh mục) - Cần token
router.get('/:productId/related', verifyToken, productController.getRelatedProducts);

// Lấy sản phẩm thường mua cùng - Cần token
router.get('/:productId/also-bought', verifyToken, productController.getAlsoBoughtProducts);
router.get('/:id/recommendations', verifyToken, productController.getProductRecommendations);


// === CÁC ROUTE ĐỘNG ===

// Lấy danh sách sản phẩm (chung)
router.get('/', productController.getAllProducts);

// Lấy chi tiết một sản phẩm
router.get('/:id', productController.getProductById);

// Tạo sản phẩm mới
router.post('/', verifyToken, productController.createProduct);

// Cập nhật sản phẩm
router.put('/:id', verifyToken, productController.updateProduct);

// Xóa sản phẩm
router.delete('/:id', verifyToken, productController.deleteProduct);

module.exports = router;
