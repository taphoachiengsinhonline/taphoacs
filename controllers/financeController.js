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
        console.log(`[FINANCE_LOG] Bắt đầu lấy overview cho Seller ID: ${sellerId}`);

        const totalRevenueResult = await LedgerEntry.aggregate([
            { $match: { seller: sellerId, type: 'credit' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalRevenue = totalRevenueResult[0]?.total || 0;
        console.log(`[FINANCE_LOG] Tổng doanh thu (totalRevenue) tính được: ${totalRevenue}`);

        const totalPayoutResult = await LedgerEntry.aggregate([
            { $match: { seller: sellerId, type: 'debit' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalPayout = totalPayoutResult[0]?.total || 0;
        console.log(`[FINANCE_LOG] Tổng đã rút (totalPayout) tính được: ${totalPayout}`);

        const availableBalance = totalRevenue - totalPayout;
        console.log(`[FINANCE_LOG] Số dư có thể rút (availableBalance) tính được: ${availableBalance}`);

        const responseData = { totalRevenue, availableBalance };
        console.log(`[FINANCE_LOG] Dữ liệu trả về cho /sellers/finance-overview:`, JSON.stringify(responseData));
        res.status(200).json(responseData);

    } catch (error) {
        console.error(`[FINANCE_LOG] Lỗi ở getSellerFinanceOverview:`, error);
        res.status(500).json({ message: 'Lỗi server khi lấy thông tin tài chính.' });
    }
};

// API để seller lấy lịch sử giao dịch (sổ cái)
exports.getSellerLedger = async (req, res) => {
    try {
        const sellerId = req.user._id;
        console.log(`[FINANCE_LOG] Bắt đầu lấy ledger cho Seller ID: ${sellerId}`);
        
        const ledgerEntries = await LedgerEntry.find({ seller: sellerId })
            .sort({ createdAt: -1 })
            .limit(50);

        console.log(`[FINANCE_LOG] Tìm thấy ${ledgerEntries.length} bút toán.`);
        console.log(`[FINANCE_LOG] Dữ liệu trả về cho /sellers/ledger:`, JSON.stringify(ledgerEntries.slice(0, 2))); // Log 2 cái đầu
        res.status(200).json(ledgerEntries);

    } catch (error) {
        console.error(`[FINANCE_LOG] Lỗi ở getSellerLedger:`, error);
        res.status(500).json({ message: 'Lỗi server khi lấy lịch sử giao dịch.' });
    }
};

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
