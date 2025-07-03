// controllers/sellerController.js

const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const PendingUpdate = require('../models/PendingUpdate');
const { sendOtpSms } = require('../utils/sms');
const crypto = require('crypto');
const moment = require('moment-timezone'); // Thêm moment-timezone

// ==============================================================================
// ===                  API CHO DASHBOARD - ĐÃ NÂNG CẤP                       ===
// ==============================================================================
exports.getDashboardStats = async (req, res) => {
    try {
        const sellerId = req.user._id;

        // --- Lấy dữ liệu sản phẩm và đơn hàng đang chờ (song song) ---
        const productStatsPromise = Product.aggregate([
            { $match: { seller: sellerId } },
            { $group: { _id: '$approvalStatus', count: { $sum: 1 } } }
        ]);
        
        const ordersToProcessPromise = Order.countDocuments({
            'items.sellerId': sellerId,
            status: { $in: ['Chờ xác nhận', 'Đang xử lý'] }
        });
        
        const inventoryPromise = Product.aggregate([
            { $match: { seller: sellerId, approvalStatus: 'approved' } },
            { $project: {
                totalStock: {
                    $cond: {
                        if: { $and: [ { $isArray: '$variantTable' }, { $gt: [ { $size: '$variantTable' }, 0 ] } ] },
                        then: { $sum: '$variantTable.stock' },
                        else: '$stock'
                    }
                }
            }},
            { $group: {
                _id: null,
                lowStockCount: { $sum: { $cond: [ { $and: [ { $gt: ['$totalStock', 0] }, { $lte: ['$totalStock', 5] } ] }, 1, 0 ] } },
                outOfStockCount: { $sum: { $cond: [ { $eq: ['$totalStock', 0] }, 1, 0 ] } }
            }}
        ]);

        // --- Logic mới: Tính toán doanh thu 7 ngày qua ---
        const sevenDaysAgo = moment().tz('Asia/Ho_Chi_Minh').subtract(6, 'days').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();

        const revenueLast7DaysPromise = Order.aggregate([
            { $match: { 
                'items.sellerId': sellerId, 
                status: 'Đã giao',
                'timestamps.deliveredAt': { $gte: sevenDaysAgo, $lte: todayEnd }
            }},
            { $unwind: '$items' },
            { $match: { 'items.sellerId': sellerId }},
            { $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamps.deliveredAt", timezone: "Asia/Ho_Chi_Minh" } },
                dailyRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
            }},
            { $sort: { _id: 1 } }
        ]);

        // --- Chạy tất cả các promise cùng lúc ---
        const [
            productCounts, 
            ordersToProcess, 
            inventoryStats,
            revenueLast7Days
        ] = await Promise.all([
            productStatsPromise,
            ordersToProcessPromise,
            inventoryPromise,
            revenueLast7DaysPromise
        ]);
        
        // --- Xử lý kết quả ---
        const stats = productCounts.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
        }, { approved: 0, pending_approval: 0, rejected: 0 });
        
        // Chuẩn bị dữ liệu cho biểu đồ
        const chartData = {
            labels: [],
            datasets: [{ data: [] }]
        };
        const revenueMap = new Map(revenueLast7Days.map(item => [item._id, item.dailyRevenue]));
        for (let i = 6; i >= 0; i--) {
            const day = moment().tz('Asia/Ho_Chi_Minh').subtract(i, 'days');
            const dayKey = day.format('YYYY-MM-DD');
            const dayLabel = day.format('DD/MM');
            chartData.labels.push(dayLabel);
            chartData.datasets[0].data.push(Math.round((revenueMap.get(dayKey) || 0) / 1000));
        }

        res.json({
            productStats: stats,
            ordersToProcess: ordersToProcess,
            lowStockCount: inventoryStats[0]?.lowStockCount || 0,
            outOfStockCount: inventoryStats[0]?.outOfStockCount || 0,
            revenueChartData: chartData
        });

    } catch (error) {
        console.error("Lỗi getDashboardStats:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy thống kê dashboard' });
    }
};

// ==============================================================================
// ===                      CÁC HÀM KHÁC GIỮ NGUYÊN                             ===
// ==============================================================================
exports.getSellerProducts = async (req, res) => {
    try {
        const products = await Product.find({ seller: req.user._id }).sort({ createdAt: -1 });
        res.json(products);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getSellerOrders = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const orders = await Order.find({ 'items.sellerId': sellerId })
            .populate('user', 'name')
            .sort({ updatedAt: -1 }); // Sắp xếp theo ngày cập nhật
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

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

exports.requestUpdatePaymentInfo = async (req, res) => {
    try {
        const { bankName, accountHolderName, accountNumber } = req.body;
        if (!bankName || !accountHolderName || !accountNumber) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin thanh toán.' });
        }
        const otp = crypto.randomInt(100000, 999999).toString();
        await PendingUpdate.deleteMany({ userId: req.user._id, type: 'paymentInfo' });
        await PendingUpdate.create({
            userId: req.user._id,
            type: 'paymentInfo',
            otp,
            payload: { bankName, accountHolderName, accountNumber }
        });
        await sendOtpSms(req.user.phone, otp);
        res.status(200).json({ message: 'Mã xác thực đã được gửi đến số điện thoại của bạn.' });
    } catch (error) {
        console.error("Lỗi khi yêu cầu cập nhật thông tin thanh toán:", error);
        res.status(500).json({ message: 'Lỗi server khi yêu cầu cập nhật.' });
    }
};

exports.verifyUpdatePaymentInfo = async (req, res) => {
    try {
        const { otp } = req.body;
        if (!otp || otp.length !== 6) return res.status(400).json({ message: 'Vui lòng nhập mã OTP gồm 6 chữ số.' });
        const pendingRequest = await PendingUpdate.findOne({
            userId: req.user._id,
            otp,
            type: 'paymentInfo',
            expiresAt: { $gt: new Date() }
        });
        if (!pendingRequest) return res.status(400).json({ message: 'Mã OTP không hợp lệ hoặc đã hết hạn.' });
        const { bankName, accountHolderName, accountNumber } = pendingRequest.payload;
        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            { $set: { 'paymentInfo.bankName': bankName, 'paymentInfo.accountHolderName': accountHolderName, 'paymentInfo.accountNumber': accountNumber } },
            { new: true, runValidators: true }
        ).select('-password');
        await PendingUpdate.findByIdAndDelete(pendingRequest._id);
        res.status(200).json({ message: 'Cập nhật thông tin thanh toán thành công!', user: updatedUser });
    } catch (error) {
        console.error("Lỗi khi xác thực OTP:", error);
        res.status(500).json({ message: 'Lỗi server khi xác thực OTP.' });
    }
};
