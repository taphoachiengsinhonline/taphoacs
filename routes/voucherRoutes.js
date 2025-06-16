const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const authMiddleware = require('../middleware/auth');

// API cho người dùng
router.get('/available', voucherController.getAvailableVouchers); // Lấy voucher có thể thu thập
router.post('/:id/collect', authMiddleware.verifyToken, voucherController.collectVoucher); // Thu thập voucher
router.get('/my', authMiddleware.verifyToken, voucherController.getMyVouchers); // Lấy voucher của tôi
router.post('/apply', authMiddleware.verifyToken, voucherController.applyVoucher); // Áp dụng voucher

// API cho admin
router.post('/', authMiddleware.verifyAdmin, voucherController.createVoucher); // Tạo voucher
router.delete('/:id', authMiddleware.verifyAdmin, voucherController.deleteVoucher); // Xóa voucher
router.put('/new-user-settings', authMiddleware.verifyAdmin, voucherController.updateNewUserVoucherSettings); // Cài đặt voucher khách mới

module.exports = router;
