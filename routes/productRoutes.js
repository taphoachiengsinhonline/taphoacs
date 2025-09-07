// File: backend/routes/productRoutes.js

const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
// <<< 1. Import thêm optionalAuth >>>
const { verifyToken, optionalAuth } = require('../middlewares/authMiddleware');

// =======================================================
// === CÁC ROUTE CÔNG KHAI HOẶC CÓ ĐIỀU KIỆN           ===
// === (Sử dụng optionalAuth)                          ===
// =======================================================

// Lấy danh sách sản phẩm (Trang chủ, trang danh mục)
// - Khách vãng lai: thấy tất cả.
// - User đăng nhập: lọc theo khu vực.
router.get('/', optionalAuth, productController.getAllProducts);

// Lấy sản phẩm bán chạy nhất
// - Khách vãng lai: thấy tất cả.
// - User đăng nhập: lọc theo khu vực.
router.get('/bestsellers', optionalAuth, productController.getBestSellers);


// =======================================================
// === CÁC ROUTE YÊU CẦU ĐĂNG NHẬP BẮT BUỘC          ===
// === (Sử dụng verifyToken)                           ===
// =======================================================

// Lấy sản phẩm liên quan (cùng danh mục) cho trang chi tiết sản phẩm
router.get('/:productId/related', verifyToken, productController.getRelatedProducts);

// Lấy sản phẩm thường được mua cùng cho trang chi tiết sản phẩm
router.get('/:productId/also-bought', verifyToken, productController.getAlsoBoughtProducts);


// =======================================================
// === CÁC ROUTE KHÁC                                  ===
// =======================================================

// Lấy chi tiết một sản phẩm (công khai, không cần token)
router.get('/:id', productController.getProductById);

// Tạo sản phẩm mới (yêu cầu đăng nhập và có thể cần quyền seller)
router.post('/', verifyToken, productController.createProduct);

// Cập nhật sản phẩm (yêu cầu đăng nhập và quyền sở hữu)
router.put('/:id', verifyToken, productController.updateProduct);

// Xóa sản phẩm (yêu cầu đăng nhập và quyền sở hữu)
router.delete('/:id', verifyToken, productController.deleteProduct);

module.exports = router;
