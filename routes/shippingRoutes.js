const express = require('express');
const router = express.Router();
const shippingController = require('../controllers/shippingController');
const { verifyToken, isAdminMiddleware } = require('../middlewares/authMiddleware');

router.get('/fees', verifyToken, shippingController.getShippingFees);
router.put('/fees', verifyToken, isAdminMiddleware, shippingController.updateShippingFees);
router.get('/free-ship', verifyToken, shippingController.getFreeShipThreshold);
router.put('/free-ship', verifyToken, isAdminMiddleware, shippingController.updateFreeShipThreshold);

module.exports = router;
