// routes/orderRoutes.js

const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { verifyToken, isAdminMiddleware } = require('../middlewares/authMiddleware');

// === CÁC ROUTE CỤ THỂ (phải đặt trước route động /:id) ===

// User:
router.get('/my-orders',  verifyToken,           orderController.getMyOrders);
router.get('/count-by-status', verifyToken,      orderController.countOrdersByStatus);

// Admin:
router.get('/',           verifyToken, isAdminMiddleware, orderController.getAllOrders);
router.get('/admin-count-by-status', [verifyToken, verifyRegionManager], orderController.adminCountByStatus);

// Shipper:
router.get('/shippers/orders', verifyToken, orderController.getShipperOrders);
router.post('/shippers/orders/:id/accept', verifyToken, orderController.acceptOrder);
router.put('/shippers/orders/:id/status', verifyToken, orderController.updateOrderStatusByShipper);

// === ROUTE TẠO ĐƠN (POST) ===
router.post('/', verifyToken, orderController.createOrder);


// === CÁC ROUTE ĐỘNG (/:id) - PHẢI ĐẶT Ở CUỐI CÙNG ===

router.get('/:id/chat-status', verifyToken, orderController.getOrderAndChatStatus);
// Lấy chi tiết đơn hàng (dùng cho cả user, admin, shipper)
router.get('/:id',        verifyToken,           orderController.getOrderById);

// Cập nhật trạng thái (chỉ admin)
router.put('/:id',        verifyToken, isAdminMiddleware, orderController.updateOrderStatus);

// Hủy đơn (user hoặc admin)
router.put('/:id/cancel', verifyToken,           orderController.cancelOrder);

router.post('/request-consultation', verifyToken, orderController.requestConsultation);
// Route mới cho khách hàng xác nhận đơn hàng sau khi được báo giá
router.post('/:id/confirm-priced-order', verifyToken, orderController.confirmPricedOrder);

module.exports = router;
