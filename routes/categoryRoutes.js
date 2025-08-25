// File: backend/routes/categoryRoutes.js (Phiên bản bảo mật)

const express = require('express');
const router = express.Router();

// Import controller
const categoryController = require('../controllers/categoryController');

// Import middleware để xác thực và kiểm tra quyền Admin
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');

// =======================================================
// === CÁC ROUTE CÔNG KHAI (Public Routes)             ===
// === Bất kỳ ai cũng có thể xem danh sách danh mục    ===
// =======================================================

// Lấy tất cả danh mục (cho trang chủ, trang sản phẩm...)
// Ai cũng có thể xem nên không cần verifyToken
router.get('/', categoryController.getAllCategories);

// Lấy danh sách danh mục của một người bán cụ thể (cho trang cửa hàng)
// Ai cũng có thể xem nên không cần verifyToken
router.get('/by-seller', categoryController.getCategoriesBySeller);


// =======================================================
// === CÁC ROUTE BẢO MẬT (Admin-Only Routes)          ===
// === Chỉ có Admin mới có quyền thực hiện các hành động này ===
// =======================================================

// Middleware `verifyToken` sẽ chạy trước để xác thực người dùng.
// Middleware `isAdmin` sẽ chạy tiếp theo để kiểm tra xem người dùng đó có vai trò 'admin' hay không.
// Nếu một trong hai kiểm tra thất bại, yêu cầu sẽ bị từ chối ngay lập tức.

// Tạo một danh mục mới
router.post('/', verifyToken, isAdmin, categoryController.createCategory);

// Cập nhật thông tin một danh mục
router.put('/:id', verifyToken, isAdmin, categoryController.updateCategory);

// Xóa một danh mục
router.delete('/:id', verifyToken, isAdmin, categoryController.deleteCategory);


module.exports = router;
