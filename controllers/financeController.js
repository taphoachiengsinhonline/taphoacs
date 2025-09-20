// controllers/financeController.js
const User = require('../models/User');
const LedgerEntry = require('../models/LedgerEntry');
const Order = require('../models/Order');
const PayoutRequest = require('../models/PayoutRequest');
const moment = require('moment-timezone');

// Hàm này được gọi khi một đơn hàng được chuyển sang trạng thái "Đã giao"
exports.processOrderCompletionForFinance = async (orderId) => {
    try {
        console.log(`[FINANCE_PROCESS] Bắt đầu xử lý tài chính cho Order ID: ${orderId}`);
        const order = await Order.findById(orderId).populate('profitRecipient'); // <<< populate để lấy thông tin người nhận lợi nhuận

        if (!order || order.status !== 'Đã giao') {
            console.log(`[FINANCE_PROCESS_SKIP] Bỏ qua: Đơn ${orderId} không ở trạng thái "Đã giao" hoặc không tồn tại.`);
            return;
        }

        const existingLedger = await LedgerEntry.findOne({ order: orderId });
        if (existingLedger) {
            console.log(`[FINANCE_PROCESS_SKIP] Bỏ qua: Đơn ${orderId} đã được xử lý tài chính trước đó.`);
            return;
        }

        // --- Bước 1: Tính toán lợi nhuận gộp của đơn hàng ---
        const itemsTotalValue = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const totalCommissionFromSeller = order.items.reduce((sum, item) => sum + (item.commissionAmount || 0), 0);
        
        // Lợi nhuận gộp = (Phí sàn thu từ seller) + (Phí ship thực tế) + (Phụ phí) - (Thu nhập trả cho shipper)
        const grossProfit = 
            (totalCommissionFromSeller || 0) + 
            (order.shippingFeeActual || 0) + 
            (order.extraSurcharge || 0) - 
            (order.shipperIncome || 0);

        console.log(`[FINANCE_PROCESS] Đơn hàng ${orderId} - Lợi nhuận gộp: ${grossProfit}`);

        // --- Bước 2: Phân chia lợi nhuận cho người nhận (Admin hoặc Quản lý Vùng) ---
        let recipientProfitAmount = 0;
        if (grossProfit > 0) {
            // Lấy tỷ lệ chia sẻ đã được lưu lúc tạo đơn hàng
            const profitShareRate = order.profitShareRateSnapshot || 100;
            recipientProfitAmount = grossProfit * (profitShareRate / 100);
            
            // Cập nhật lại đơn hàng với số lợi nhuận cuối cùng
            order.recipientProfit = recipientProfitAmount;
            await order.save();
            
            console.log(`[FINANCE_PROCESS] Lợi nhuận được chia cho "${order.profitRecipient ? order.profitRecipient.name : 'Admin trung tâm'}" là ${recipientProfitAmount} (${profitShareRate}%)`);
        }

        // --- Bước 3: Ghi bút toán cho các Seller (Logic này giữ nguyên) ---
        const sellerFinanceData = {};
        for (const item of order.items) {
            const sellerId = item.sellerId.toString();
            if (!sellerFinanceData[sellerId]) {
                sellerFinanceData[sellerId] = { netIncome: 0 };
            }
            const itemValue = item.price * item.quantity;
            const commission = item.commissionAmount || 0; 
            sellerFinanceData[sellerId].netIncome += (itemValue - commission);
        }
        
        console.log(`[FINANCE_PROCESS_AGGREGATE] Dữ liệu tài chính tổng hợp cho các seller:`, sellerFinanceData);

        for (const sellerId in sellerFinanceData) {
            const { netIncome } = sellerFinanceData[sellerId];
            if (netIncome <= 0) {
                 console.log(`[FINANCE_PROCESS_LEDGER_SKIP] Bỏ qua seller ${sellerId} vì thu nhập ròng là ${netIncome}.`);
                 continue;
            }
            
            const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
            const currentBalance = lastEntry ? lastEntry.balanceAfter : 0;
            const newBalance = currentBalance + netIncome;

            await LedgerEntry.create({
                seller: sellerId,
                order: order._id,
                type: 'credit',
                amount: netIncome,
                description: `Thanh toán cho đơn hàng #${order._id.toString().slice(-6)}`,
                balanceAfter: newBalance,
            });
            console.log(`[FINANCE_PROCESS_LEDGER_SUCCESS] Đã tạo bút toán 'credit' thành công cho seller ${sellerId}.`);
        }
    } catch (error) {
        console.error(`[FINANCE_PROCESS_ERROR] Lỗi khi xử lý tài chính cho đơn hàng ${orderId}:`, error);
    }
};

// Hàm lấy thông tin tài chính tổng quan
exports.getSellerFinanceOverview = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const { startDate, endDate } = req.query;
        
        const from = startDate ? moment.tz(startDate, 'Asia/Ho_Chi_Minh').startOf('day') : moment().tz('Asia/Ho_Chi_Minh').startOf('month');
        const to = endDate ? moment.tz(endDate, 'Asia/Ho_Chi_Minh').endOf('day') : moment().tz('Asia/Ho_Chi_Minh').endOf('month');

        // <<< SỬA LỖI LOGIC TÍNH TOÁN >>>
        
        // 1. TÍNH TỔNG DOANH THU TRONG KHOẢNG THỜI GIAN
        // Chỉ tính các khoản cộng tiền (credit) trong khoảng thời gian đã chọn
        const revenueResult = await LedgerEntry.aggregate([
            { $match: { 
                seller: sellerId,
                type: 'credit', // Chỉ cộng các khoản thu vào
                createdAt: { $gte: from.toDate(), $lte: to.toDate() }
            }},
            { $group: {
                _id: null,
                total: { $sum: '$amount' }
            }}
        ]);
        const totalRevenueInRange = revenueResult[0]?.total || 0;

        // 2. TÍNH SỐ DƯ CÓ THỂ RÚT
        // Luôn luôn lấy bút toán cuối cùng, không phụ thuộc vào ngày tháng
        const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
        const availableBalance = lastEntry ? lastEntry.balanceAfter : 0;
        
        // <<< KẾT THÚC SỬA LỖI >>>

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
        // <<< NHẬN THÊM DỮ LIỆU TỪ BODY >>>
        const { amount, paymentDetails } = req.body;

        if (!amount || amount <= 0) return res.status(400).json({ message: 'Số tiền không hợp lệ.' });
        // <<< KIỂM TRA THÔNG TIN THANH TOÁN >>>
        if (!paymentDetails || !paymentDetails.bankName || !paymentDetails.accountNumber) {
            return res.status(400).json({ message: 'Thiếu thông tin thanh toán để tạo yêu cầu.' });
        }
        
        // <<< SỬA ĐỔI: Không lấy amount từ body nữa, luôn rút hết số dư >>>
        const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
        const availableBalance = lastEntry ? lastEntry.balanceAfter : 0;
        
        if (availableBalance <= 0) {
            return res.status(400).json({ message: 'Số dư của bạn không đủ để tạo yêu cầu.' });
        }
        
        const existingPendingRequest = await PayoutRequest.findOne({ seller: sellerId, status: { $in: ['pending', 'processing'] } });
        if (existingPendingRequest) {
            return res.status(400).json({ message: 'Bạn đã có một yêu cầu đang được xử lý.' });
        }

        // <<< SỬA ĐỔI: Chỉ tạo PayoutRequest, KHÔNG tạo bút toán debit >>>
        const newRequest = new PayoutRequest({
            seller: sellerId,
            amount: availableBalance, // Luôn yêu cầu rút toàn bộ số dư hiện có
            payoutDetails: paymentDetails,
        });

        await newRequest.save();
        
        // Không còn bút toán debit ở đây nữa
        console.log(`[FINANCE] Seller ${sellerId} đã tạo yêu cầu rút tiền ${availableBalance}. Chờ admin xử lý.`);

        res.status(201).json({ message: 'Yêu cầu rút tiền đã được gửi thành công.', request: newRequest });

    } catch (error) {
        console.error("Lỗi tạo yêu cầu rút tiền:", error);
        res.status(500).json({ message: 'Lỗi server khi tạo yêu cầu rút tiền.' });
    }
};

// API để seller xem lịch sử các yêu cầu rút tiền của mình
exports.getPayoutHistory = async (req, res) => {
    try {
        const sellerId = req.user._id;
        console.log(`[API /payout-history] Bắt đầu lấy lịch sử rút tiền cho Seller ID: ${sellerId}`);

        const history = await PayoutRequest.find({ seller: sellerId })
            .sort({ createdAt: -1 }) // Sắp xếp yêu cầu mới nhất lên đầu
            .limit(100); // Giới hạn 100 yêu cầu gần nhất để tối ưu

        console.log(`[API /payout-history] Tìm thấy ${history.length} yêu cầu.`);
        res.status(200).json(history);

    } catch (error) {
        console.error(`[API /payout-history] Lỗi nghiêm trọng:`, error);
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
