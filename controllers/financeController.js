// controllers/financeController.js

const User = require('../models/User');
const LedgerEntry = require('../models/LedgerEntry');
const Order = require('../models/Order');

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

// API để seller lấy số dư hiện tại
exports.getSellerBalance = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
        
        const balance = lastEntry ? lastEntry.balanceAfter : 0;
        
        res.status(200).json({ balance });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi lấy số dư.' });
    }
};

// API để seller lấy lịch sử giao dịch (sổ cái)
exports.getSellerLedger = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const ledgerEntries = await LedgerEntry.find({ seller: sellerId })
            .sort({ createdAt: -1 })
            .limit(50); // Giới hạn 50 giao dịch gần nhất

        res.status(200).json(ledgerEntries);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi lấy lịch sử giao dịch.' });
    }
};
