const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const authMiddleware = require('../middlewares/authMiddleware');

// Tạo đơn hàng
router.post('/', authMiddleware, orderController.createOrder);

module.exports = router;
