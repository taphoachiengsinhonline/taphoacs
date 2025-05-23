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

// Hủy đơn (user hoặc admin)
router.put('/:id/cancel', verifyToken,           orderController.cancelOrder);

module.exports = router;
