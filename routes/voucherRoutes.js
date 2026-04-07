// File: backend/routes/voucherRoutes.js

const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const { protect, restrictTo } = require('../middlewares/authMiddleware');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware xác thực tùy chọn: Có token thì đọc, không có token thì vẫn cho qua (Khách vãng lai)
const optionalAuth = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.userId);
        } catch (err) {
            // Token lỗi hoặc hết hạn thì coi như khách vãng lai, không crash app
        }
    }
    next();
};

// ========================================================
// ROUTE CÔNG KHAI (Áp dụng optionalAuth cho khách & user)
// ========================================================
router.get('/available', optionalAuth, voucherController.getAvailableVouchers);


// ========================================================
// ROUTES BẮT BUỘC ĐĂNG NHẬP (Áp dụng protect)
// ========================================================
router.use(protect);

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
