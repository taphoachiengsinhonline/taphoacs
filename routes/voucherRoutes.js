const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

router.use(protect);

// Route cụ thể phải đặt trước route động (:id)
router.get('/available', voucherController.getAvailableVouchers);
router.get('/my-vouchers', voucherController.getMyVouchers);
router.post('/collect/:id', voucherController.collectVoucher);
router.post('/apply', voucherController.applyVoucher);

// Route admin
router.get('/', restrictTo('admin'), voucherController.getAllVouchers);
router.post('/', restrictTo('admin'), voucherController.createVoucher);
router.post('/bulk', restrictTo('admin'), voucherController.createBulkVouchers);

// Route động (:id) đặt cuối
router.get('/:id', voucherController.getVoucherById);
router.delete('/:id', restrictTo('admin'), voucherController.deleteVoucher);
router.patch('/:id', restrictTo('admin'), voucherController.updateVoucher);

module.exports = router;
