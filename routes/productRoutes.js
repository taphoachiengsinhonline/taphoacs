// backend/routes/productRoutes.js

const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { verifyToken } = require('../middlewares/authMiddleware');

// === CÁC ROUTE CỤ THỂ (phải đặt trước route động /:id) ===

// Lấy sản phẩm bán chạy nhất
router.get('/bestsellers', productController.getBestSellers);

// <<< ROUTE MỚI: LẤY SẢN PHẨM GỢI Ý CHO MỘT SẢN PHẨM CỤ THỂ >>>
router.get('/:id/recommendations', productController.getProductRecommendations);


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
