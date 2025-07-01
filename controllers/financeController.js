// controllers/financeController.js
const User = require('../models/User');
const LedgerEntry = require('../models/LedgerEntry');
const Order = require('../models/Order');
const PayoutRequest = require('../models/PayoutRequest');

// Hàm tính toán và cập nhật số dư của seller
// Hàm này sẽ được gọi khi một đơn hàng được chuyển sang trạng thái "Đã giao"
exports.processOrderCompletionForFinance = async (orderId) => {
    try {
        const order = await Order.findById(orderId).populate('items.sellerId');
        if (!order || order.status !== 'Đã giao') {
            // Không phải đơn đã giao hoặc không tìm thấy
            return;
        }

        // Nhóm các item theo seller
        const sellerItems = {};
        order.items.forEach(item => {
            const sellerId = item.sellerId._id.toString();
            if (!sellerItems[sellerId]) {
                sellerItems[sellerId] = {
                    totalValue: 0,
                    totalCommission: 0,
                };
            }
            const itemValue = item.price * item.quantity;
            sellerItems[sellerId].totalValue += itemValue;
            sellerItems[sellerId].totalCommission += item.commissionAmount || 0;
        });

        // Tạo các bút toán cho từng seller
        for (const sellerId in sellerItems) {
            const seller = await User.findById(sellerId);
            if (!seller) continue;

            const { totalValue, totalCommission } = sellerItems[sellerId];
            const netIncome = totalValue - totalCommission;

            // Lấy số dư hiện tại
            const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
            const currentBalance = lastEntry ? lastEntry.balanceAfter : 0;
            const newBalance = currentBalance + netIncome;

            // Tạo bút toán ghi có
            await LedgerEntry.create({
                seller: sellerId,
                order: order._id,
                type: 'credit',
                amount: netIncome,
                description: `Thanh toán cho đơn hàng #${order._id.toString().slice(-6)}`,
                balanceAfter: newBalance,
            });
        }
        console.log(`[Finance] Đã xử lý tài chính cho đơn hàng ${orderId}`);

    } catch (error) {
        console.error(`[Finance] Lỗi khi xử lý tài chính cho đơn hàng ${orderId}:`, error);
    }
};

// API để seller lấy thông tin tài chính tổng quan
exports.getSellerFinanceOverview = async (req, res) => {
    try {
        const sellerId = req.user._id;

        // Tính tổng doanh thu (tất cả các khoản credit)
        const totalRevenueResult = await LedgerEntry.aggregate([
            { $match: { seller: sellerId, type: 'credit' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalRevenue = totalRevenueResult[0]?.total || 0;

        // Tính tổng số tiền đã rút (tất cả các khoản debit)
        const totalPayoutResult = await LedgerEntry.aggregate([
            { $match: { seller: sellerId, type: 'debit' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalPayout = totalPayoutResult[0]?.total || 0;

        // Số dư có thể rút = Tổng doanh thu - Tổng đã rút
        const availableBalance = totalRevenue - totalPayout;

        res.status(200).json({
            totalRevenue,       // Tổng doanh thu từ trước đến nay
            availableBalance,   // Số dư có thể rút
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi lấy thông tin tài chính.' });
    }
};

// API để seller lấy lịch sử giao dịch (sổ cái)
exports.getSellerLedger = async (req, res) => { /* Giữ nguyên không đổi */ };

// API để seller tạo yêu cầu rút tiền
exports.createPayoutRequest = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const { amount } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Số tiền yêu cầu không hợp lệ.' });
        }

        // Kiểm tra xem seller có yêu cầu nào đang chờ xử lý không
        const existingPendingRequest = await PayoutRequest.findOne({ seller: sellerId, status: { $in: ['pending', 'processing'] } });
        if (existingPendingRequest) {
            return res.status(400).json({ message: 'Bạn đã có một yêu cầu rút tiền đang được xử lý.' });
        }
        
        // Lấy số dư hiện tại
        const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
        const availableBalance = lastEntry ? lastEntry.balanceAfter : 0;
        
        if (amount > availableBalance) {
            return res.status(400).json({ message: 'Số tiền yêu cầu vượt quá số dư có thể rút.' });
        }

        const newRequest = new PayoutRequest({
            seller: sellerId,
            amount: amount,
        });

        await newRequest.save();
        res.status(201).json({ message: 'Yêu cầu rút tiền đã được gửi thành công.', request: newRequest });

    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi tạo yêu cầu rút tiền.' });
    }
};
