// routes/sellerRoutes.js

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const User = require('../models/User'); 
const financeController = require('../controllers/financeController');
const sellerController = require('../controllers/sellerController'); // <<< THÊM CONTROLLER MỚI

// Middleware chung cho router này, đảm bảo chỉ seller mới truy cập được
const restrictToSeller = (req, res, next) => {
    if (req.user.role !== 'seller') {
        return res.status(403).json({ message: 'Yêu cầu quyền người bán' });
    }
    next();
};
router.use(verifyToken, restrictToSeller);


// --- CÁC API MỚI VÀ ĐÚNG CHUẨN ---

// API cho Dashboard Screen
router.get('/dashboard-stats', sellerController.getDashboardStats);

router.get('/conversations', sellerController.getSellerConversations);

// API cho ProductList Screen
router.get('/products', sellerController.getSellerProducts);

// API cho OrderList Screen
router.get('/orders', sellerController.getSellerOrders);

// API để cập nhật FCM token
router.post('/update-fcm-token', sellerController.updateFcmToken);

// API cho Finance Screen
router.get('/finance', financeController.getSellerFinanceOverview);
router.get('/ledger', financeController.getSellerLedger);
router.post('/payout-request', financeController.createPayoutRequest);
router.get('/payout-history', verifyToken, financeController.getPayoutHistory);
router.post('/payment-info/request-update', verifyToken, sellerController.requestUpdatePaymentInfo);
router.post('/payment-info/verify-update', verifyToken, sellerController.verifyUpdatePaymentInfo);

module.exports = router;
