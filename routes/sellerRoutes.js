// routes/sellerRoutes.js

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const User = require('../models/User'); 
const financeController = require('../controllers/financeController');
const sellerController = require('../controllers/sellerController');

// ... (middleware giữ nguyên) ...
const restrictToSeller = (req, res, next) => {
    if (req.user.role !== 'seller') {
        return res.status(403).json({ message: 'Yêu cầu quyền người bán' });
    }
    next();
};
router.use(verifyToken, restrictToSeller);


// --- CÁC API CŨ GIỮ NGUYÊN ---
router.get('/dashboard-stats', sellerController.getDashboardStats);
router.get('/conversations', sellerController.getSellerConversations);
router.get('/products', sellerController.getSellerProducts);
router.get('/orders', sellerController.getSellerOrders);
router.post('/update-fcm-token', sellerController.updateFcmToken);
router.get('/finance', financeController.getSellerFinanceOverview);
router.get('/ledger', financeController.getSellerLedger);
router.post('/payout-request', financeController.createPayoutRequest);
router.get('/payout-history', verifyToken, financeController.getPayoutHistory);
router.post('/payment-info/request-update', verifyToken, sellerController.requestUpdatePaymentInfo);
router.post('/payment-info/verify-update', verifyToken, sellerController.verifyUpdatePaymentInfo);
router.post('/change-password', sellerController.changePassword);

// --- ROUTE MỚI CHO MÀN HÌNH ĐỐI SOÁT ---
router.get('/monthly-remittance', sellerController.getMonthlyRemittanceDetails);


module.exports = router;
