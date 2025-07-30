// routes/productRoutes.js

const express = require('express');
const router = express.Router();

// Import controller chứa logic xử lý
const productController = require('../controllers/productController');

// Import middleware để bảo vệ các route
const { verifyToken, isAdminMiddleware } = require('../middlewares/authMiddleware');

// === CÁC ROUTE CÔNG KHAI (KHÔNG CẦN ĐĂNG NHẬP) ===

// Lấy danh sách sản phẩm (dùng cho cả trang chủ và trang của seller)
// Route này bị trùng với route GET ở dưới, nhưng tôi giữ lại logic từ file gốc của bạn.
// Bạn nên xem xét gộp 2 route GET / này lại.
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


// Ghi chú: Route GET / bị trùng lặp ở file gốc của bạn, tôi giữ lại cả hai.
// Bạn nên xem xét và chỉ giữ lại một route GET / duy nhất cho rõ ràng.
router.get('/', async (req, res) => {
  try {
    const { sellerId } = req.query;
    let query = {};
    if (sellerId) {
      query.createdBy = sellerId;
    }
    const products = await Product.find(query).sort({ createdAt: -1 }).limit(20);
    res.json(products);
  } catch (err) {
    console.error('[Products] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
