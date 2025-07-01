// controllers/sellerController.js

const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');

// API cho Dashboard
exports.getDashboardStats = async (req, res) => {
    try {
        const sellerId = req.user._id;

        // Đếm sản phẩm theo trạng thái
        const productStatsPromise = Product.aggregate([
            { $match: { seller: sellerId } },
            { $group: { _id: '$approvalStatus', count: { $sum: 1 } } }
        ]);

        // Lấy tất cả các ID sản phẩm của seller
        const sellerProducts = await Product.find({ seller: sellerId }).select('_id');
        const productIds = sellerProducts.map(p => p._id);

        // Đếm đơn hàng đang chờ xử lý của seller
        const ordersToProcessPromise = Order.countDocuments({
            'items.sellerId': sellerId,
            status: { $in: ['Chờ xác nhận', 'Đang xử lý'] }
        });
        
        // Lấy dữ liệu doanh thu
        const revenueDataPromise = Order.aggregate([
            { $unwind: '$items' },
            { $match: { 'items.sellerId': sellerId, status: 'Đã giao' } },
            { $group: {
                _id: null,
                totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
            }}
        ]);

        const [productCounts, ordersToProcess, revenueData] = await Promise.all([
            productStatsPromise,
            ordersToProcessPromise,
            revenueDataPromise,
        ]);
        
        const stats = productCounts.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
        }, { approved: 0, pending_approval: 0, rejected: 0 });

        res.json({
            productStats: stats,
            ordersToProcess: ordersToProcess,
            totalRevenue: revenueData[0]?.totalRevenue || 0,
            // Thêm các thống kê khác nếu cần
        });

    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi lấy thống kê dashboard' });
    }
};

// API lấy sản phẩm của Seller
exports.getSellerProducts = async (req, res) => {
    try {
        const products = await Product.find({ seller: req.user._id }).sort({ createdAt: -1 });
        res.json(products);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// API lấy đơn hàng của Seller
exports.getSellerOrders = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const orders = await Order.find({ 'items.sellerId': sellerId })
            .populate('user', 'name')
            .sort({ updatedAt: -1 }); 
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// API cập nhật FCM Token
exports.updateFcmToken = async (req, res) => {
    try {
        const { fcmToken } = req.body;
        if (!fcmToken) return res.status(400).json({ message: "Thiếu fcmToken" });
        await User.findByIdAndUpdate(req.user._id, { fcmToken });
        res.status(200).json({ message: "Cập nhật FCM token cho seller thành công" });
    } catch (error) {
        res.status(500).json({ message: "Lỗi server" });
    }
};
