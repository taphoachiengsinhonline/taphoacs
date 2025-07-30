// routes/productRoutes.js

const express = require('express');
const router = express.Router();

// Import controller chứa logic xử lý
const productController = require('../controllers/productController');

// Import middleware để bảo vệ các route
const { verifyToken, isAdminMiddleware } = require('../middlewares/authMiddleware');

// === CÁC ROUTE CÔNG KHAI (KHÔNG CẦN ĐĂNG NHẬP) ===

// Lấy danh sách sản phẩm (dùng cho cả trang chủ và trang của seller)
// Đây là route DUY NHẤT cho việc lấy danh sách sản phẩm.
router.get('/', productController.getAllProducts);

// Lấy chi tiết một sản phẩm
router.get('/:id', productController.getProductById);


// === CÁC ROUTE CẦN ĐĂNG NHẬP (verifyToken) ===

// Seller hoặc Admin tạo sản phẩm mới
router.post('/', verifyToken, productController.createProduct);

// Seller hoặc Admin cập nhật sản phẩm
router.put('/:id', verifyToken, productController.updateProduct);

// Seller hoặc Admin xóa sản phẩm
router.delete('/:id', verifyToken, productController.deleteProduct);


// <<< ĐÃ XÓA HOÀN TOÀN KHỐI ROUTER.GET('/') BỊ TRÙNG LẶP Ở ĐÂY >>>


module.exports = router;
