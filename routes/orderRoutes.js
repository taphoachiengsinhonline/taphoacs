// routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { 
  verifyToken, 
  isAdminMiddleware,
  isStaffMiddleware 
} = require('../middlewares/authMiddleware');

// █████ User Routes █████
router.post('/', verifyToken, orderController.createOrder);
router.get('/my-orders', verifyToken, orderController.getMyOrders);
router.get('/count-by-status', verifyToken, orderController.countOrdersByStatus);
router.get('/:id', verifyToken, orderController.getOrderById);
router.put('/:id/cancel', verifyToken, orderController.cancelOrder);

// █████ Admin Routes █████
router.get('/', verifyToken, isAdminMiddleware, orderController.getAllOrders);
router.put('/:id', verifyToken, isAdminMiddleware, orderController.updateOrderStatus);


// █████ Delivery Staff Routes █████

router.get('/delivery/available', 
  verifyToken, 
  isStaffMiddleware, 
  orderController.getAvailableDeliveryOrders
);

router.put('/delivery/:id/accept',
  verifyToken,
  isStaffMiddleware,
  orderController.acceptOrderDelivery
);

router.put('/delivery/:id/update-status',
  verifyToken,
  isStaffMiddleware,
  orderController.updateDeliveryStatus
);

router.get('/delivery/my-assigned',
  verifyToken,
  isStaffMiddleware,
  orderController.getMyAssignedOrders
);

// █████ Hybrid Routes (Admin + Staff) █████
router.put('/:id/location',
  verifyToken,
  (req, res, next) => {
    if (req.user.role === 'staff' || req.user.role === 'admin') return next();
    res.status(403).json({ message: 'Không có quyền truy cập' });
  },
  orderController.updateOrderLocation
);

module.exports = router
