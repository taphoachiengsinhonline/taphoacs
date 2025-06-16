const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const { verifyToken, isAdminMiddleware } = require('../middlewares/authMiddleware');

router.get('/', verifyToken, voucherController.getVouchers);
router.post('/', verifyToken, isAdminMiddleware, voucherController.createVoucher);
router.post('/apply', verifyToken, voucherController.applyVoucher);
router.delete('/:id', verifyToken, isAdminMiddleware, voucherController.deleteVoucher);

module.exports = router;
