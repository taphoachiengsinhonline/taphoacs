const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');

// API cho người dùng
router.get('/available', voucherController.getAvailableVouchers); // Lấy voucher có thể thu thập
router.post('/:id/collect', verifyToken, voucherController.collectVoucher); // Thu thập voucher
router.get('/my', verifyToken, voucherController.getMyVouchers); // Lấy voucher của tôi
router.post('/apply', verifyToken, voucherController.applyVoucher); // Áp dụng voucher

// API cho admin
router.post('/', verifyToken, isAdmin, voucherController.createVoucher); // Tạo voucher
router.delete('/:id', verifyToken, isAdmin, voucherController.deleteVoucher); // Xóa voucher
router.put('/new-user-settings', verifyToken, isAdmin, voucherController.updateNewUserVoucherSettings); // Cài đặt voucher khách mới

module.exports = router;
