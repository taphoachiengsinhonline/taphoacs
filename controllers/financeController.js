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


// API để seller lấy thông tin tài chính tổng quan
exports.getSellerFinanceOverview = async (req, res) => {
    try {
        const sellerId = req.user._id;
        console.log(`[API /finance-overview] Lấy overview cho Seller ID: ${sellerId}`);

        // Lấy bút toán cuối cùng để xác định số dư có thể rút
        const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
        const availableBalance = lastEntry ? lastEntry.balanceAfter : 0;
        console.log(`[API /finance-overview] Số dư có thể rút (từ bút toán cuối): ${availableBalance}`);

        // Tính tổng doanh thu bằng cách cộng tất cả các khoản "credit"
        const totalRevenueResult = await LedgerEntry.aggregate([
            { $match: { seller: sellerId, type: 'credit' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalRevenue = totalRevenueResult[0]?.total || 0;
        console.log(`[API /finance-overview] Tổng doanh thu (từ tất cả credit): ${totalRevenue}`);

        const responseData = { totalRevenue, availableBalance };
        res.status(200).json(responseData);

    } catch (error) {
        console.error(`[API /finance-overview] Lỗi:`, error);
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
        const { amount } = req.body;

        if (!amount || amount <= 0) return res.status(400).json({ message: 'Số tiền yêu cầu không hợp lệ.' });
        
        const existingPendingRequest = await PayoutRequest.findOne({ seller: sellerId, status: { $in: ['pending', 'processing'] } });
        if (existingPendingRequest) return res.status(400).json({ message: 'Bạn đã có một yêu cầu rút tiền đang được xử lý.' });
        
        const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
        const availableBalance = lastEntry ? lastEntry.balanceAfter : 0;
        
        if (amount > availableBalance) return res.status(400).json({ message: 'Số tiền yêu cầu vượt quá số dư có thể rút.' });

        const newRequest = new PayoutRequest({ seller: sellerId, amount: amount });
        await newRequest.save();
        res.status(201).json({ message: 'Yêu cầu rút tiền đã được gửi thành công.', request: newRequest });

    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi tạo yêu cầu rút tiền.' });
    }
};
