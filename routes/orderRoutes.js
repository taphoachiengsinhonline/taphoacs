// routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { verifyToken, isAdminMiddleware } = require('../middlewares/authMiddleware');

// Người dùng:
router.post('/',          verifyToken,           orderController.createOrder);
router.get('/my-orders',  verifyToken,           orderController.getMyOrders);
router.get('/count-by-status', verifyToken,      orderController.countOrdersByStatus);
router.get('/:id',        verifyToken,           orderController.getOrderById);

// Admin:
router.get('/',           verifyToken, isAdminMiddleware, orderController.getAllOrders);
router.put('/:id',        verifyToken, isAdminMiddleware, orderController.updateOrderStatus);


// <<< THÊM ROUTE MỚI NÀY VÀO PHẦN ADMIN >>>
router.get('/admin-count-by-status', verifyToken, isAdminMiddleware, orderController.adminCountByStatus);

// Hủy đơn (user hoặc admin)
router.put('/:id/cancel', verifyToken,           orderController.cancelOrder);

router.post('/shippers/orders/:id/accept', verifyToken, orderController.acceptOrder);
router.put('/shippers/orders/:id/status', verifyToken, orderController.updateOrderStatusByShipper);
router.get('/shippers/orders', verifyToken, orderController.getShipperOrders);



module.exports = router;
