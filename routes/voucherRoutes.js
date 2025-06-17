const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const { verifyToken, restrictTo } = require('../middleware/authMiddleware');
router.use(verifyToken);
router.get('/my', voucherController.getMyVouchers);
router.post('/collect/:id', voucherController.collectVoucher);
router.get('/', restrictTo('admin'), voucherController.getAllVouchers);
router.post('/', restrictTo('admin'), voucherController.createVoucher);
router.get('/:id', restrictTo('admin'), voucherController.getVoucherById);
router.patch('/:id', restrictTo('admin'), voucherController.updateVoucher);
router.delete('/:id', restrictTo('admin'), voucherController.deleteVoucher);
router.post('/apply', voucherController.applyVoucher);
router.post('/bulk', restrictTo('admin'), voucherController.createBulkVouchers); // Dòng lỗi
module.exports = router;
