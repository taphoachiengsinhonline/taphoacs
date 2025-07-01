// controllers/financeController.js

const User = require('../models/User');
const LedgerEntry = require('../models/LedgerEntry');
const Order = require('../models/Order');
const PayoutRequest = require('../models/PayoutRequest');

// Hàm này được gọi khi một đơn hàng được chuyển sang trạng thái "Đã giao"
exports.processOrderCompletionForFinance = async (orderId) => {
    try {
        console.log(`[FINANCE_PROCESS_START] Bắt đầu xử lý tài chính cho Order ID: ${orderId}`);
        const order = await Order.findById(orderId);

        if (!order) {
            console.error(`[FINANCE_PROCESS_FAIL] Không tìm thấy đơn hàng với ID: ${orderId}`);
            return;
        }
        if (order.status !== 'Đã giao') {
            console.log(`[FINANCE_PROCESS_SKIP] Bỏ qua: Đơn ${orderId} có trạng thái là "${order.status}", không phải "Đã giao".`);
            return;
        }

        // Kiểm tra xem đã xử lý tài chính cho đơn này chưa
        const existingLedger = await LedgerEntry.findOne({ order: orderId });
        if (existingLedger) {
            console.log(`[FINANCE_PROCESS_SKIP] Bỏ qua: Đơn ${orderId} đã được xử lý tài chính trước đó.`);
            return;
        }

        console.log(`[FINANCE_PROCESS_DATA] Dữ liệu items trong đơn hàng:`, JSON.stringify(order.items, null, 2));

        const sellerFinanceData = {};

        for (const item of order.items) {
            const sellerId = item.sellerId.toString();
            console.log(`[FINANCE_PROCESS_ITEM] Đang xử lý item của Seller: ${sellerId}`);

            if (!sellerFinanceData[sellerId]) {
                sellerFinanceData[sellerId] = {
                    totalValue: 0,
                    totalCommission: 0,
                };
            }
            const itemValue = item.price * item.quantity;
            const commission = item.commissionAmount || 0;

            console.log(`[FINANCE_PROCESS_ITEM]   - Giá trị item: ${itemValue}`);
            console.log(`[FINANCE_PROCESS_ITEM]   - Phí sàn: ${commission}`);
            
            sellerFinanceData[sellerId].totalValue += itemValue;
            sellerFinanceData[sellerId].totalCommission += commission;
        }
        
        console.log(`[FINANCE_PROCESS_AGGREGATE] Dữ liệu tài chính tổng hợp cho các seller:`, sellerFinanceData);

        for (const sellerId in sellerFinanceData) {
            const { totalValue, totalCommission } = sellerFinanceData[sellerId];
            const netIncome = totalValue - totalCommission;

            if (netIncome <= 0) {
                 console.log(`[FINANCE_PROCESS_LEDGER_SKIP] Bỏ qua seller ${sellerId} vì thu nhập ròng là ${netIncome}.`);
                 continue;
            }
            
            const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
            const currentBalance = lastEntry ? lastEntry.balanceAfter : 0;
            const newBalance = currentBalance + netIncome;

            console.log(`[FINANCE_PROCESS_LEDGER_CREATE] Chuẩn bị tạo bút toán cho Seller ${sellerId}:`);
            console.log(`  - Số dư cũ: ${currentBalance}`);
            console.log(`  - Thu nhập mới: ${netIncome}`);
            console.log(`  - Số dư mới: ${newBalance}`);

            await LedgerEntry.create({
                seller: sellerId,
                order: order._id,
                type: 'credit',
                amount: netIncome,
                description: `Thanh toán cho đơn hàng #${order._id.toString().slice(-6)}`,
                balanceAfter: newBalance,
            });
            console.log(`[FINANCE_PROCESS_LEDGER_SUCCESS] ĐÃ TẠO BÚT TOÁN 'credit' thành công cho seller ${sellerId}.`);
        }
        console.log(`[FINANCE_PROCESS_END] Hoàn tất xử lý tài chính cho Order ID: ${orderId}`);

    } catch (error) {
        console.error(`[FINANCE_PROCESS_ERROR] Lỗi nghiêm trọng khi xử lý tài chính cho đơn hàng ${orderId}:`, error);
    }
};


// API để seller lấy thông tin tài chính (đã nâng cấp)
exports.getSellerFinanceOverview = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const { startDate, endDate } = req.query;
        
        // Mặc định là tháng hiện tại nếu không có query
        const from = startDate ? moment.tz(startDate, 'Asia/Ho_Chi_Minh').startOf('day') : moment().tz('Asia/Ho_Chi_Minh').startOf('month');
        const to = endDate ? moment.tz(endDate, 'Asia/Ho_Chi_Minh').endOf('day') : moment().tz('Asia/Ho_Chi_Minh').endOf('month');

        // 1. Tính tổng doanh thu ròng trong khoảng thời gian đã chọn
        const revenueResult = await LedgerEntry.aggregate([
            { $match: { 
                seller: sellerId,
                createdAt: { $gte: from.toDate(), $lte: to.toDate() }
            }},
            { $group: {
                _id: '$type',
                total: { $sum: '$amount' }
            }}
        ]);
        
        const credit = revenueResult.find(r => r._id === 'credit')?.total || 0;
        const debit = revenueResult.find(r => r._id === 'debit')?.total || 0;
        const totalRevenueInRange = credit - debit;

        // 2. Tính số dư có thể rút (luôn là tổng từ trước đến nay)
        const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
        const availableBalance = lastEntry ? lastEntry.balanceAfter : 0;

        res.status(200).json({
            totalRevenue: totalRevenueInRange,
            availableBalance,
            period: {
                start: from.format('YYYY-MM-DD'),
                end: to.format('YYYY-MM-DD')
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi lấy thông tin tài chính.' });
    }
};

// API để seller lấy lịch sử giao dịch (sổ cái)
exports.getSellerLedger = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const ledgerEntries = await LedgerEntry.find({ seller: sellerId }).sort({ createdAt: -1 }).limit(50);
        res.status(200).json(ledgerEntries);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi lấy lịch sử giao dịch.' });
    }
};

// API để seller tạo yêu cầu rút tiền
exports.createPayoutRequest = async (req, res) => {
    try {
        const sellerId = req.user._id;
        
        const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
        const availableBalance = lastEntry ? lastEntry.balanceAfter : 0;
        
        if (availableBalance <= 0) {
            return res.status(400).json({ message: 'Số dư của bạn không đủ để tạo yêu cầu.' });
        }
        
        const existingPending = await PayoutRequest.findOne({ seller: sellerId, status: { $in: ['pending', 'processing'] } });
        if (existingPending) {
            return res.status(400).json({ message: 'Bạn đã có một yêu cầu đang được xử lý.' });
        }

        // Tạo yêu cầu rút tiền
        const newRequest = new PayoutRequest({
            seller: sellerId,
            amount: availableBalance, // Rút toàn bộ số dư
        });
        await newRequest.save();

        // Tạo bút toán Ghi nợ (debit) để reset số dư về 0
        const newBalance = 0;
        await LedgerEntry.create({
            seller: sellerId,
            type: 'debit',
            amount: availableBalance,
            description: `Yêu cầu rút tiền #${newRequest._id.toString().slice(-6)}`,
            balanceAfter: newBalance
        });

        res.status(201).json({ message: 'Yêu cầu rút tiền đã được gửi thành công.', request: newRequest });

    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi tạo yêu cầu rút tiền.' });
    }
};

// API để seller xem lịch sử các yêu cầu rút tiền của mình
exports.getPayoutHistory = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const history = await PayoutRequest.find({ seller: sellerId }).sort({ createdAt: -1 });
        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi lấy lịch sử rút tiền.' });
    }
};

exports.reverseFinancialEntryForOrder = async (orderId, cancelReason) => {
    try {
        console.log(`[FINANCE_REVERSE] Bắt đầu đảo ngược tài chính cho đơn hàng bị hủy: ${orderId}`);

        // Tìm tất cả các bút toán Ghi có (credit) liên quan đến đơn hàng này
        const creditEntries = await LedgerEntry.find({ order: orderId, type: 'credit' });

        if (creditEntries.length === 0) {
            console.log(`[FINANCE_REVERSE] Không tìm thấy bút toán nào để đảo ngược cho đơn hàng ${orderId}.`);
            return;
        }

        for (const creditEntry of creditEntries) {
            // Kiểm tra xem đã có bút toán đảo ngược chưa để tránh chạy 2 lần
            const existingReversal = await LedgerEntry.findOne({ 
                order: orderId, 
                type: 'debit', 
                description: { $regex: /Hoàn trả/ } 
            });

            if (existingReversal) {
                console.log(`[FINANCE_REVERSE] Đơn hàng ${orderId} đã được hoàn trả tài chính trước đó. Bỏ qua.`);
                continue;
            }

            const sellerId = creditEntry.seller;
            const amountToReverse = creditEntry.amount;

            // Lấy số dư hiện tại của seller
            const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
            const currentBalance = lastEntry ? lastEntry.balanceAfter : 0;
            const newBalance = currentBalance - amountToReverse;

            console.log(`[FINANCE_REVERSE] Chuẩn bị tạo bút toán Ghi nợ (debit) cho Seller ${sellerId}:`);
            console.log(`  - Số dư cũ: ${currentBalance}`);
            console.log(`  - Số tiền hoàn trả: ${amountToReverse}`);
            console.log(`  - Số dư mới: ${newBalance}`);

            // Tạo bút toán Ghi nợ (debit) để trừ tiền
            await LedgerEntry.create({
                seller: sellerId,
                order: orderId,
                type: 'debit',
                amount: amountToReverse,
                description: `Hoàn trả cho đơn hàng #${orderId.toString().slice(-6)} (Lý do: ${cancelReason})`,
                balanceAfter: newBalance,
            });
            console.log(`[FINANCE_REVERSE_SUCCESS] Đã tạo bút toán hoàn trả thành công cho seller ${sellerId}.`);
        }
    } catch (error) {
        console.error(`[FINANCE_REVERSE_ERROR] Lỗi khi đảo ngược tài chính cho đơn hàng ${orderId}:`, error);
    }
};
