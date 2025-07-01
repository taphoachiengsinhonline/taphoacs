const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const financeController = require('../controllers/financeController');

const restrictToSeller = (req, res, next) => {
    if (req.user.role !== 'seller') {
        return res.status(403).json({ message: 'Yêu cầu quyền người bán' });
    }
    next();
};

// Middleware chung cho router này
router.use(verifyToken, restrictToSeller);

// GET /api/v1/sellers/dashboard-stats
router.get('/dashboard-stats', async (req, res) => {
    try {
        const sellerId = req.user._id;

        // Đếm sản phẩm theo trạng thái
        const productCounts = await Product.aggregate([
            { $match: { seller: sellerId } },
            { $group: { _id: '$approvalStatus', count: { $sum: 1 } } }
        ]);
        const productStats = productCounts.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
        }, { pending_approval: 0, approved: 0, rejected: 0 });

        // Đếm đơn hàng và doanh thu
        // Logic này phức tạp, cần query qua tất cả các đơn hàng
        const orders = await Order.find({ 'items.productId': { $in: await Product.find({ seller: sellerId }).distinct('_id') } });
        
        let totalRevenue = 0;
        let orderCount = orders.length;
        
        orders.forEach(order => {
            order.items.forEach(item => {
                // Tạm thời tính tổng doanh thu, chưa trừ chiết khấu
                if (item.productId.toString() in productIds) { // Cần có danh sách productIds của seller
                    totalRevenue += item.price * item.quantity;
                }
            });
        });


        res.json({
            productStats,
            totalRevenue,
            orderCount
        });

    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// GET /api/v1/sellers/products
router.get('/products', async (req, res) => {
    try {
        const products = await Product.find({ seller: req.user._id }).sort({ createdAt: -1 });
        res.json(products);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// GET /api/v1/sellers/orders
router.get('/orders', async (req, res) => {
    try {
        const sellerProducts = await Product.find({ seller: req.user._id }).select('_id');
        const productIds = sellerProducts.map(p => p._id);
        
        const orders = await Order.find({ 'items.productId': { $in: productIds } })
            .populate('user', 'name')
            .sort({ 'timestamps.createdAt': -1 });

        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

router.post('/update-fcm-token', verifyToken, async (req, res) => {
    try {
        const { fcmToken } = req.body;
        if (!fcmToken) {
            return res.status(400).json({ message: "Thiếu fcmToken" });
        }
        
        // Cập nhật token cho user seller đang đăng nhập
        await User.findByIdAndUpdate(req.user._id, { fcmToken });
        
        res.status(200).json({ message: "Cập nhật FCM token cho seller thành công" });

    } catch (error) {
        console.error("Lỗi cập nhật FCM token cho seller:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
});

router.get('/finance-overview', verifyToken, financeController.getSellerFinanceOverview);
router.get('/ledger', verifyToken, financeController.getSellerLedger);
router.post('/payout-request', verifyToken, financeController.createPayoutRequest);

module.exports = router;
