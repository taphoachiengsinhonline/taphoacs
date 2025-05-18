// routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { verifyToken, isAdminMiddleware } = require('../middlewares/authMiddleware');

// Tạo đơn hàng mới (người dùng đã đăng nhập)
router.post('/', verifyToken, orderController.createOrder);

// Lấy đơn hàng cá nhân, có thể lọc theo status
router.get('/my-orders', verifyToken, orderController.getMyOrders);

// Đếm đơn hàng theo từng trạng thái (của người dùng)
router.get('/count-by-status', verifyToken, orderController.countOrdersByStatus);

// Lấy tất cả đơn hàng (admin), có thể lọc theo status
router.get('/', verifyToken, isAdminMiddleware, orderController.getAllOrders);

// Admin cập nhật trạng thái đơn hàng
router.put('/:id', verifyToken, isAdminMiddleware, orderController.updateOrderStatus);

// Người dùng hoặc admin hủy đơn hàng
router.put('/:id/cancel', verifyToken, orderController.cancelOrder);

module.exports = router;
