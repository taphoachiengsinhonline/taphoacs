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
// <<< ROUTE MỚI: LẤY SẢN PHẨM BÁN CHẠY NHẤT >>>
router.get('/bestsellers', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 10; // Mặc định lấy 10 sản phẩm

        const bestSellers = await Order.aggregate([
            // Giai đoạn 1: Chỉ lấy các đơn hàng đã giao thành công
            { $match: { status: 'Đã giao' } },
            // Giai đoạn 2: Tách mỗi sản phẩm trong một đơn hàng ra thành một document riêng
            { $unwind: '$items' },
            // Giai đoạn 3: Nhóm theo ID sản phẩm và tính tổng số lượng đã bán
            {
                $group: {
                    _id: '$items.productId',
                    totalQuantitySold: { $sum: '$items.quantity' }
                }
            },
            // Giai đoạn 4: Sắp xếp theo số lượng bán giảm dần
            { $sort: { totalQuantitySold: -1 } },
            // Giai đoạn 5: Giới hạn số lượng kết quả
            { $limit: limit },
            // Giai đoạn 6: Lấy thông tin chi tiết của sản phẩm từ collection 'products'
            {
                $lookup: {
                    from: 'products',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'productDetails'
                }
            },
            // Giai đoạn 7: Tách mảng productDetails ra
            { $unwind: '$productDetails' },
            // Giai đoạn 8: Chỉ chọn những trường cần thiết và thay thế _id
            {
                $replaceRoot: { newRoot: '$productDetails' }
            }
        ]);

        res.json(bestSellers);
    } catch (err) {
        console.error('❌ Lỗi khi lấy sản phẩm bán chạy:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});


module.exports = router;
