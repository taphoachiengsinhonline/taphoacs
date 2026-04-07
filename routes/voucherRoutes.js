const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const { protect, restrictTo } = require('../middlewares/authMiddleware');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// MIDDLEWARE: CÓ TOKEN THÌ ĐỌC, KHÔNG CÓ THÌ CHO QUA (LÀ KHÁCH)
const optionalAuth = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.userId);
        }
    } catch (err) { }
    next();
};

// ⚠️ CỰC QUAN TRỌNG: ROUTE NÀY PHẢI ĐẶT TRÊN CÙNG (TRƯỚC KHI GỌI PROTECT)
router.get('/available', optionalAuth, voucherController.getAvailableVouchers);

// ==========================================
// TỪ ĐÂY TRỞ XUỐNG BẮT BUỘC PHẢI ĐĂNG NHẬP
// ==========================================
router.use(protect);

router.get('/my-vouchers', voucherController.getMyVouchers);
router.post('/collect/:id', voucherController.collectVoucher);
router.post('/apply', voucherController.applyVoucher);

// Route admin
router.get('/', restrictTo('admin'), voucherController.getAllVouchers);
router.post('/', restrictTo('admin'), voucherController.createVoucher);
router.post('/bulk', restrictTo('admin'), voucherController.createBulkVouchers);

router.get('/:id', voucherController.getVoucherById);
router.delete('/:id', restrictTo('admin'), voucherController.deleteVoucher);
router.patch('/:id', restrictTo('admin'), voucherController.updateVoucher);

module.exports = router;
