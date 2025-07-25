// controllers/sellerController.js

const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const PendingUpdate = require('../models/PendingUpdate');
const { sendOtpSms } = require('../utils/sms');
const crypto = require('crypto');
const moment = require('moment-timezone');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
// <<< SỬA LẠI TÊN MODEL CHO ĐÚNG >>>
const PayoutRequest = require('../models/PayoutRequest'); 
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); 

// ==============================================================================
// ===                  API CHO DASHBOARD - ĐÃ NÂNG CẤP                       ===
// ==============================================================================
exports.getDashboardStats = async (req, res) => {
    try {
        const sellerId = req.user._id;

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
        
        const stats = productCounts.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
        }, { approved: 0, pending_approval: 0, rejected: 0 });
        
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

exports.getSellerConversations = async (req, res) => {
    try {
        const sellerId = req.user._id;

        const conversations = await Conversation.find({ sellerId: sellerId })
            .populate('customerId', 'name')
            .populate('productId', 'name images')
            .sort({ updatedAt: -1 });

        const conversationsWithLastMessage = await Promise.all(
            conversations.map(async (conv) => {
                const lastMessage = await Message.findOne({ conversationId: conv._id })
                    .sort({ createdAt: -1 });
                
                return {
                    ...conv.toObject(),
                    lastMessage: lastMessage ? lastMessage.toObject() : null
                };
            })
        );
        
        res.json(conversationsWithLastMessage);

    } catch (error) {
        console.error("Lỗi khi lấy danh sách trò chuyện của Seller:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

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
            .select('customerName total status timestamps.createdAt items.name items.price items.quantity')
            .populate('user', 'name')
            // <<< SỬA LẠI SẮP XẾP TẠI ĐÂY >>>
            .sort({ _id: -1 }) // Sắp xếp theo _id giảm dần (mới nhất lên đầu)
            .lean();
            
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

// ==============================================================================
// ===                 API MỚI: ĐỐI SOÁT CHI TIẾT CHO SELLER                   ===
// ==============================================================================
exports.getMonthlyRemittanceDetails = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({ message: "Vui lòng cung cấp tháng và năm." });
        }
        
        const targetMonth = parseInt(month);
        const targetYear = parseInt(year);

        const startDate = moment.tz(`${year}-${month}-01`, "YYYY-M-DD", "Asia/Ho_Chi_Minh").startOf('month').toDate();
        const endDate = moment(startDate).endOf('month').toDate();

        const deliveredOrders = await Order.find({
            'items.sellerId': sellerId,
            status: 'Đã giao',
            'timestamps.deliveredAt': { $gte: startDate, $lte: endDate }
        }).sort({ 'timestamps.deliveredAt': -1 }).lean();

        let totalRevenue = 0;
        let totalCommission = 0;

        const detailedOrders = deliveredOrders.map(order => {
            const sellerItems = order.items.filter(item => item.sellerId.equals(sellerId));
            const orderRevenue = sellerItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const orderCommission = sellerItems.reduce((sum, item) => sum + (item.commissionAmount || 0), 0);
            
            totalRevenue += orderRevenue;
            totalCommission += orderCommission;
            
            return {
                _id: order._id,
                orderDate: order.timestamps.deliveredAt,
                revenue: orderRevenue,
                commission: orderCommission,
                netRevenue: orderRevenue - orderCommission
            };
        });

        // <<< SỬA LẠI TÊN MODEL Ở ĐÂY >>>
        const payouts = await PayoutRequest.find({
            seller: sellerId,
            status: 'completed',
            'processedAt': { $gte: startDate, $lte: endDate }
        }).sort({ processedAt: -1 }).lean();

        const totalPayout = payouts.reduce((sum, payout) => sum + payout.amount, 0);

        res.status(200).json({
            overview: {
                totalRevenue,
                totalCommission,
                netRevenue: totalRevenue - totalCommission,
                totalPayout,
                finalBalance: (totalRevenue - totalCommission) - totalPayout
            },
            orders: detailedOrders,
            payouts: payouts.map(p => ({
                _id: p._id,
                date: p.processedAt,
                amount: p.amount
            }))
        });

    } catch (error) {
        console.error("Lỗi getMonthlyRemittanceDetails:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy dữ liệu đối soát.' });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        // 1. Validation cơ bản
        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ các trường.' });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: 'Mật khẩu mới không khớp.' });
        }

        // 2. Lấy user từ DB (bao gồm cả password)
        const user = await User.findById(req.user.id).select('+password');

        // 3. Kiểm tra mật khẩu hiện tại có đúng không
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Mật khẩu hiện tại không chính xác.' });
        }

        // 4. Cập nhật mật khẩu mới và lưu
        user.password = newPassword;
        await user.save(); // Middleware pre('save') trong model User sẽ tự động hash mật khẩu mới

        // 5. Trả về thành công
        res.status(200).json({ message: 'Đổi mật khẩu thành công!' });
        
    } catch (error) {
        console.error('[changePassword Seller] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server, vui lòng thử lại.' });
    }
};
