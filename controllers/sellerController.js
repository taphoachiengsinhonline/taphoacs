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
const PayoutRequest = require('../models/PayoutRequest'); 
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); 
const Notification = require('../models/Notification');

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
            // Lấy thêm các trường cần thiết để tính toán
            .select('customerName total status timestamps items') 
            .populate('user', 'name')
            .sort({ _id: -1 })
            .lean(); // Dùng .lean() để dễ dàng thêm thuộc tính

        // TÍNH TOÁN LẠI DOANH THU CHO SELLER
        const ordersWithSellerRevenue = orders.map(order => {
            // Lọc ra các item của seller này trong đơn hàng
            const sellerItems = order.items.filter(item => item.sellerId.equals(sellerId));
            
            // Tính tổng tiền hàng của seller trong đơn hàng đó
            const sellerItemsTotal = sellerItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            
            // Trả về object order mới với trường `sellerRevenue`
            return {
                ...order,
                sellerRevenue: sellerItemsTotal // << TRƯỜNG MỚI
            };
        });
            
        res.json(ordersWithSellerRevenue);
    } catch (error) {
        console.error("Lỗi khi lấy đơn hàng của Seller:", error);
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
        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ các trường.' });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: 'Mật khẩu mới không khớp.' });
        }
        const user = await User.findById(req.user.id).select('+password');
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Mật khẩu hiện tại không chính xác.' });
        }
        user.password = newPassword;
        await user.save();
        res.status(200).json({ message: 'Đổi mật khẩu thành công!' });
    } catch (error) {
        console.error('[changePassword Seller] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server, vui lòng thử lại.' });
    }
};

exports.getNotifications = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const notifications = await Notification.find({ user: sellerId })
            .sort({ createdAt: -1 })
            .limit(100);
        res.status(200).json(notifications);
    } catch (error) { // <<< ĐÃ SỬA LỖI CÚ PHÁP Ở ĐÂY
        console.error("[Seller] Lỗi khi lấy danh sách thông báo:", error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

exports.getUnreadNotificationCount = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const count = await Notification.countDocuments({ user: sellerId, isRead: false });
        res.status(200).json({ count });
    } catch (error) { // <<< ĐÃ SỬA LỖI CÚ PHÁP Ở ĐÂY
        console.error("[Seller] Lỗi khi đếm thông báo chưa đọc:", error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

exports.markNotificationAsRead = async (req, res) => {
    try {
        const { notificationId } = req.params;
        const sellerId = req.user._id;
        
        const notification = await Notification.findOneAndUpdate(
            { _id: notificationId, user: sellerId },
            { $set: { isRead: true } },
            { new: true }
        );
        
        if (!notification) {
            return res.status(404).json({ message: 'Không tìm thấy thông báo.' });
        }
        res.status(200).json({ message: 'Đã đánh dấu đã đọc.', notification });
    } catch (error) { // <<< ĐÃ SỬA LỖI CÚ PHÁP Ở ĐÂY
        console.error("[Seller] Lỗi khi đánh dấu đã đọc:", error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

exports.updateAutoResponseMessage = async (req, res) => {
    try {
        const { message } = req.body;
        const sellerId = req.user._id;

        if (typeof message !== 'string') {
            return res.status(400).json({ message: "Dữ liệu không hợp lệ." });
        }

        // Tìm và cập nhật user
        const updatedSeller = await User.findByIdAndUpdate(
            sellerId,
            { $set: { 'sellerProfile.autoResponseMessage': message.trim() } },
            { new: true, runValidators: true }
        ).select('sellerProfile');

        if (!updatedSeller) {
            return res.status(404).json({ message: "Không tìm thấy người bán." });
        }

        res.status(200).json({
            message: "Đã cập nhật tin nhắn tự động thành công.",
            autoResponseMessage: updatedSeller.sellerProfile.autoResponseMessage
        });

    } catch (error) {
        console.error("Lỗi khi cập nhật tin nhắn tự động:", error);
        res.status(500).json({ message: "Lỗi server." });
    }
};

// --- HÀM MỚI ---
exports.getAutoResponseMessage = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const seller = await User.findById(sellerId).select('sellerProfile.autoResponseMessage');
        
        if (!seller) {
            return res.status(404).json({ message: "Không tìm thấy người bán." });
        }
        
        res.status(200).json({
            autoResponseMessage: seller.sellerProfile?.autoResponseMessage || ''
        });
    } catch (error) {
        console.error("Lỗi khi lấy tin nhắn tự động:", error);
        res.status(500).json({ message: "Lỗi server." });
    }
};
