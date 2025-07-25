// controllers/adminController.js

const User = require('../models/User');
const Remittance = require('../models/Remittance');
const Order = require('../models/Order');
const Payout = require('../models/PayoutRequest'); // <<< THÊM IMPORT
const LedgerEntry = require('../models/LedgerEntry'); 
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const RemittanceRequest = require('../models/RemittanceRequest');
const SalaryPayment = require('../models/SalaryPayment');
const Product = require('../models/Product');
const Notification = require('../models/Notification'); // Đảm bảo đã import Notification Model
const { safeNotify } = require('../utils/notificationMiddleware');
// ==============================================================
// === CÁC HÀM CŨ CỦA BẠN - GIỮ NGUYÊN HOÀN TOÀN              ===
// ==============================================================

// API để lấy danh sách tất cả các shipper và công nợ của họ
exports.getShipperDebtOverview = async (req, res) => {
    try {
        const shippers = await User.find({ role: 'shipper' }).select('name phone').lean();

        if (shippers.length === 0) {
            return res.status(200).json([]);
        }

        const shipperIds = shippers.map(s => s._id);

        const [pendingRequests, codResults, remittedResults] = await Promise.all([
            RemittanceRequest.find({ shipper: { $in: shipperIds }, status: 'pending' }).lean(),
            Order.aggregate([
                { $match: { shipper: { $in: shipperIds }, status: 'Đã giao' } },
                { $group: { _id: '$shipper', total: { $sum: '$total' } } }
            ]),
            Remittance.aggregate([
                { $match: { shipper: { $in: shipperIds }, status: 'completed' } },
                { $group: { _id: '$shipper', total: { $sum: '$amount' } } }
            ])
        ]);

        const pendingRequestMap = new Map();
        pendingRequests.forEach(req => {
            const shipperId = req.shipper.toString();
            if (!pendingRequestMap.has(shipperId)) {
                pendingRequestMap.set(shipperId, []);
            }
            pendingRequestMap.get(shipperId).push(req);
        });

        const codMap = new Map(codResults.map(item => [item._id.toString(), item.total]));
        const remittedMap = new Map(remittedResults.map(item => [item._id.toString(), item.total]));

        const debtData = shippers.map(shipper => {
            const shipperIdStr = shipper._id.toString();
            const totalCOD = codMap.get(shipperIdStr) || 0;
            const totalRemitted = remittedMap.get(shipperIdStr) || 0;
            const totalDebt = totalCOD - totalRemitted;

            return {
                ...shipper,
                totalDebt: totalDebt > 0 ? totalDebt : 0,
                pendingRequests: pendingRequestMap.get(shipperIdStr) || []
            };
        });

        debtData.sort((a, b) => {
            if (b.pendingRequests.length > a.pendingRequests.length) return 1;
            if (a.pendingRequests.length > b.pendingRequests.length) return -1;
            return b.totalDebt - a.totalDebt;
        });

        res.status(200).json(debtData);
    } catch (error) {
        console.error("[getShipperDebtOverview] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
};

// API lấy các yêu cầu nộp tiền đang chờ
exports.getPendingRemittanceRequests = async (req, res) => {
    try {
        const requests = await RemittanceRequest.find({ status: 'pending' }).populate('shipper', 'name phone').sort({ createdAt: -1 });
        res.status(200).json(requests);
    } catch (error) { res.status(500).json({ message: "Lỗi server" }); }
};

// API đếm số yêu cầu nộp tiền đang chờ
exports.countPendingRemittanceRequests = async (req, res) => {
    try {
        const count = await RemittanceRequest.countDocuments({ status: 'pending' });
        res.status(200).json({ count });
    } catch (error) { res.status(500).json({ message: "Lỗi server" }); }
};

// API Admin duyệt yêu cầu nộp tiền
exports.processRemittanceRequest = async (req, res) => {
    const { requestId } = req.params;
    const { action, adminNotes } = req.body;
    const adminId = req.user._id;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const request = await RemittanceRequest.findById(requestId).session(session);
        if (!request || request.status !== 'pending') {
            throw new Error("Yêu cầu không hợp lệ hoặc đã được xử lý.");
        }

        if (action === 'approve') {
            if (request.isForOldDebt) {
                let amountToApply = request.amount;
                const orders = await Order.find({ shipper: request.shipper, status: 'Đã giao' }).sort({ 'timestamps.deliveredAt': 1 }).session(session);
                const allRemittances = await Remittance.find({ shipper: request.shipper, status: 'completed' }).session(session);

                const remittedMap = new Map();
                allRemittances.forEach(r => { remittedMap.set(moment(r.remittanceDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD'), r.amount || 0); });

                const debtByDay = {};
                orders.forEach(o => {
                    const day = moment(o.timestamps.deliveredAt).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
                    debtByDay[day] = (debtByDay[day] || 0) + (o.total || 0);
                });

                const sortedDebtDays = Object.keys(debtByDay).sort();
                const todayString = moment().tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');

                for (const day of sortedDebtDays) {
                    if (amountToApply <= 0) break;
                    if (day >= todayString) continue;

                    const debtOfDay = (debtByDay[day] || 0) - (remittedMap.get(day) || 0);
                    if (debtOfDay > 0) {
                        const payment = Math.min(debtOfDay, amountToApply);
                        await Remittance.findOneAndUpdate(
                            { shipper: request.shipper, remittanceDate: moment.tz(day, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh').startOf('day').toDate() },
                            { $inc: { amount: payment }, $set: { status: 'completed' }, $push: { transactions: { amount: payment, confirmedAt: new Date(), notes: `Admin duyệt trả nợ cũ (Req: ${requestId})` } } },
                            { upsert: true, new: true, session: session }
                        );
                        amountToApply -= payment;
                    }
                }
            } else {
                const today = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
                await Remittance.findOneAndUpdate(
                    { shipper: request.shipper, remittanceDate: today },
                    { $inc: { amount: request.amount }, $set: { status: 'completed' }, $push: { transactions: { amount: request.amount, confirmedAt: new Date(), notes: `Admin duyệt (Req: ${requestId})` } } },
                    { upsert: true, new: true, session: session }
                );
            }
            request.status = 'approved';
        } else if (action === 'reject') {
            request.status = 'rejected';
        } else {
            throw new Error("Hành động không hợp lệ.");
        }

        request.adminNotes = adminNotes;
        request.processedAt = new Date();
        request.approvedBy = adminId;
        await request.save({ session });
        
        await session.commitTransaction();
        res.status(200).json({ message: `Đã ${action === 'approve' ? 'xác nhận' : 'từ chối'} yêu cầu thành công.` });
    } catch (error) {
        await session.abortTransaction();
        console.error("[processRemittanceRequest] Lỗi:", error);
        res.status(500).json({ message: error.message });
    } finally {
        session.endSession();
    }
};


// ==========================================================
// ===          CÁC HÀM MỚI ĐỂ QUẢN LÝ LƯƠNG            ===
// ==========================================================

// API để admin trả lương
exports.payShipperSalary = async (req, res) => {
    try {
        const { shipperId } = req.params;
        // <<< SỬA: Chỉ cần amount và notes từ body >>>
        const { amount, notes } = req.body;
        const adminId = req.user._id;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Số tiền thanh toán không hợp lệ." });
        }
        
        // <<< SỬA: paymentDate sẽ là ngày hiện tại >>>
        const paymentDate = new Date();

        const newPayment = new SalaryPayment({
            shipper: shipperId,
            amount: amount,
            paymentDate: paymentDate, // Ngày trả lương là ngày admin bấm nút
            paidBy: adminId,
            notes: notes
        });

        await newPayment.save();
        
        res.status(201).json({ message: 'Thanh toán lương thành công!', payment: newPayment });

    } catch (error) {
        console.error('[payShipperSalary] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi thanh toán lương.' });
    }
};

exports.getShipperFinancialDetails = async (req, res) => {
    try {
        const { shipperId } = req.params;
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({ message: "Vui lòng cung cấp tháng và năm." });
        }

        const targetMonth = parseInt(month);
        const targetYear = parseInt(year);

        const [incomeAggregation, paymentAggregation, remittances] = await Promise.all([
            // 1. Tính TỔNG THU NHẬP trong tháng
            Order.aggregate([
                {
                    $match: {
                        shipper: new mongoose.Types.ObjectId(shipperId),
                        status: 'Đã giao',
                        'timestamps.deliveredAt': { $exists: true, $ne: null }
                    }
                },
                {
                    $project: {
                        income: "$shipperIncome",
                        year: { $year: { date: "$timestamps.deliveredAt", timezone: "Asia/Ho_Chi_Minh" } },
                        month: { $month: { date: "$timestamps.deliveredAt", timezone: "Asia/Ho_Chi_Minh" } }
                    }
                },
                { $match: { year: targetYear, month: targetMonth } },
                { $group: { _id: null, totalIncome: { $sum: "$income" } } }
            ]),
            
            // 2. Tính TỔNG LƯƠNG ĐÃ TRẢ trong tháng
            SalaryPayment.aggregate([
                {
                    $match: {
                        shipper: new mongoose.Types.ObjectId(shipperId),
                        'paymentDate': { $exists: true, $ne: null }
                    }
                },
                {
                    $project: {
                        amount: "$amount",
                        year: { $year: { date: "$paymentDate", timezone: "Asia/Ho_Chi_Minh" } },
                        month: { $month: { date: "$paymentDate", timezone: "Asia/Ho_Chi_Minh" } }
                    }
                },
                { $match: { year: targetYear, month: targetMonth } },
                { $group: { _id: null, totalPaid: { $sum: "$amount" } } }
            ]),
            
            // 3. Lấy lịch sử nộp COD (giữ nguyên, logic này đã đúng)
            Remittance.find({
                shipper: new mongoose.Types.ObjectId(shipperId),
                remittanceDate: {
                    $gte: moment({ year: targetYear, month: targetMonth - 1 }).startOf('month').toDate(),
                    $lte: moment({ year: targetYear, month: targetMonth - 1 }).endOf('month').toDate()
                },
                status: 'completed'
            }).sort({ remittanceDate: -1 }).lean()
        ]);
        
        const totalIncome = incomeAggregation[0]?.totalIncome || 0;
        const totalSalaryPaid = paymentAggregation[0]?.totalPaid || 0;

        res.status(200).json({
            totalIncome: totalIncome,
            totalSalaryPaid: totalSalaryPaid,
            remittances: remittances
        });

    } catch (error) {
        console.error('[getShipperFinancialDetails] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

// API MỚI: LẤY TỔNG QUAN TÀI CHÍNH CỦA TẤT CẢ SHIPPER
exports.getShipperFinancialOverview = async (req, res) => {
    try {
        const shippers = await User.find({ role: 'shipper' }).select('name phone').lean();
        if (shippers.length === 0) return res.status(200).json([]);

        const shipperIds = shippers.map(s => s._id);

        const [codResults, remittedResults, incomeResults, salaryPaidResults] = await Promise.all([
            Order.aggregate([
                { $match: { shipper: { $in: shipperIds }, status: 'Đã giao' } },
                { $group: { _id: '$shipper', total: { $sum: '$total' } } }
            ]),
            Remittance.aggregate([
                { $match: { shipper: { $in: shipperIds }, status: 'completed' } },
                { $group: { _id: '$shipper', total: { $sum: '$amount' } } }
            ]),
            Order.aggregate([
                { $match: { shipper: { $in: shipperIds }, status: 'Đã giao' } },
                { $group: { _id: '$shipper', total: { $sum: '$shipperIncome' } } }
            ]),
            SalaryPayment.aggregate([
                { $match: { shipper: { $in: shipperIds } } },
                { $group: { _id: '$shipper', total: { $sum: '$amount' } } }
            ])
        ]);

        const codMap = new Map(codResults.map(item => [item._id.toString(), item.total]));
        const remittedMap = new Map(remittedResults.map(item => [item._id.toString(), item.total]));
        const incomeMap = new Map(incomeResults.map(item => [item._id.toString(), item.total]));
        const salaryPaidMap = new Map(salaryPaidResults.map(item => [item._id.toString(), item.total]));

        const financialData = shippers.map(shipper => {
            const shipperIdStr = shipper._id.toString();
            
            const totalCOD = codMap.get(shipperIdStr) || 0;
            const totalRemitted = remittedMap.get(shipperIdStr) || 0;
            const codDebt = totalCOD - totalRemitted;

            const totalIncome = incomeMap.get(shipperIdStr) || 0;
            const totalSalaryPaid = salaryPaidMap.get(shipperIdStr) || 0;
            const salaryToPay = totalIncome - totalSalaryPaid;

            return {
                ...shipper,
                codDebt: codDebt > 0 ? codDebt : 0,
                salaryToPay: salaryToPay > 0 ? salaryToPay : 0
            };
        });

        financialData.sort((a, b) => {
            if (b.salaryToPay > a.salaryToPay) return 1;
            if (a.salaryToPay > b.salaryToPay) return -1;
            return b.codDebt - a.codDebt;
        });

        res.status(200).json(financialData);
    } catch (error) {
        console.error("[getShipperFinancialOverview] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
};


// <<< ========================================================= >>>
// <<< === CÁC HÀM MỚI ĐỂ QUẢN LÝ TÀI CHÍNH CỦA SELLER         === >>>
// <<< ========================================================= >>>

// API LẤY TỔNG QUAN TÀI CHÍNH CỦA TẤT CẢ SELLER (cho màn hình danh sách)
exports.getSellerFinancialOverview = async (req, res) => {
    try {
        const sellers = await User.find({ role: 'seller', approvalStatus: 'approved' }).select('name phone commissionRate').lean();
        if (sellers.length === 0) return res.status(200).json([]);

        const sellerIds = sellers.map(s => s._id);

        // Lấy bút toán cuối cùng của mỗi seller để biết số dư hiện tại
        const lastLedgerEntries = await LedgerEntry.aggregate([
            { $match: { seller: { $in: sellerIds } } },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: '$seller',
                    lastBalance: { $first: '$balanceAfter' }
                }
            }
        ]);

        const balanceMap = new Map(lastLedgerEntries.map(item => [item._id.toString(), item.lastBalance]));

        const financialData = sellers.map(seller => {
            const sellerIdStr = seller._id.toString();
            const availableBalance = balanceMap.get(sellerIdStr) || 0;

            return {
                ...seller,
                availableBalance: availableBalance > 0 ? availableBalance : 0,
            };
        });

        financialData.sort((a, b) => b.availableBalance - a.availableBalance);

        res.status(200).json(financialData);
    } catch (error) {
        console.error("[getSellerFinancialOverview] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
};


// API LẤY DỮ LIỆU TÀI CHÍNH TOÀN DIỆN CỦA 1 SELLER (cho màn hình chi tiết)
exports.getSellerComprehensiveFinancials = async (req, res) => {
    try {
        const { sellerId } = req.params;
        const sellerObjectId = new mongoose.Types.ObjectId(sellerId);

        const seller = await User.findById(sellerId).select('name phone paymentInfo commissionRate').lean();
        if (!seller) {
            return res.status(404).json({ message: "Không tìm thấy seller." });
        }

        const todayStart = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();
        const monthStart = moment().tz('Asia/Ho_Chi_Minh').startOf('month').toDate();
        const monthEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('month').toDate();

        const [
            allTimeRevenue,
            todayRevenue,
            thisMonthRevenue,
            lastLedgerEntry
        ] = await Promise.all([
            // Tổng doanh thu (credit) từ trước đến nay
            LedgerEntry.aggregate([
                { $match: { seller: sellerObjectId, type: 'credit' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            // Doanh thu hôm nay
            LedgerEntry.aggregate([
                { $match: { seller: sellerObjectId, type: 'credit', createdAt: { $gte: todayStart, $lte: todayEnd } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            // Doanh thu tháng này
            LedgerEntry.aggregate([
                { $match: { seller: sellerObjectId, type: 'credit', createdAt: { $gte: monthStart, $lte: monthEnd } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            // Lấy bút toán cuối cùng để biết số dư
            LedgerEntry.findOne({ seller: sellerObjectId }).sort({ createdAt: -1 }).lean()
        ]);

        const totalRevenue = allTimeRevenue[0]?.total || 0;
        const availableBalance = lastLedgerEntry?.balanceAfter || 0;
        const totalPaidOut = totalRevenue - availableBalance;
        
        const finalData = {
            sellerInfo: seller,
            allTime: {
                totalRevenue,
                totalPaidOut,
                availableBalance
            },
            today: {
                revenue: todayRevenue[0]?.total || 0,
            },
            thisMonth: {
                revenue: thisMonthRevenue[0]?.total || 0,
            }
        };

        res.status(200).json(finalData);

    } catch (error) {
        console.error('[getSellerComprehensiveFinancials] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy dữ liệu tài chính seller.' });
    }
};

// API ĐỂ ADMIN THANH TOÁN CHO SELLER
exports.payToSeller = async (req, res) => {
    try {
        const { sellerId } = req.params;
        const { amount, notes } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Số tiền thanh toán không hợp lệ." });
        }

        const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
        const currentBalance = lastEntry ? lastEntry.balanceAfter : 0;

        if (amount > currentBalance) {
            return res.status(400).json({ message: "Số tiền thanh toán không được lớn hơn số dư hiện có của seller." });
        }

        const newBalance = currentBalance - amount;

        // Tạo bút toán Ghi nợ (debit)
        await LedgerEntry.create({
            seller: sellerId,
            type: 'debit',
            amount,
            description: notes || `Admin thanh toán cho seller`,
            balanceAfter: newBalance,
        });

        res.status(201).json({ message: 'Đã ghi nhận thanh toán cho seller thành công!' });

    } catch (error) {
        console.error('[payToSeller] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi thanh toán cho seller.' });
    }
};

exports.getAllPendingCounts = async (req, res) => {
    try {
        const [productCount, payoutCount, remittanceCount] = await Promise.all([
            Product.countDocuments({ approvalStatus: 'pending_approval' }),
            PayoutRequest.countDocuments({ status: 'pending' }),
            RemittanceRequest.countDocuments({ status: 'pending' })
        ]);

        res.status(200).json({
            pendingProducts: productCount,
            pendingPayouts: payoutCount,
            pendingRemittances: remittanceCount
        });
    } catch (error) {
        console.error('[getAllPendingCounts] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getPendingSellers = async (req, res) => {
    try {
        const pendingSellers = await User.find({ role: 'seller', approvalStatus: 'pending' })
            .select('name email phone createdAt') // Chỉ lấy các trường cần thiết
            .sort({ createdAt: -1 }); // Sắp xếp theo ngày tạo mới nhất

        res.status(200).json(pendingSellers);
    } catch (error) {
        console.error("[getPendingSellers] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server khi lấy danh sách seller." });
    }
};

// Phê duyệt một tài khoản Seller
exports.approveSeller = async (req, res) => {
    try {
        const { sellerId } = req.params;
        const seller = await User.findOneAndUpdate(
            { _id: sellerId, role: 'seller', approvalStatus: 'pending' },
            { $set: { approvalStatus: 'approved' } },
            { new: true }
        );

        if (!seller) {
            return res.status(404).json({ message: 'Không tìm thấy Seller đang chờ duyệt với ID này.' });
        }

        // (Tùy chọn) Gửi thông báo cho Seller rằng tài khoản của họ đã được duyệt

        res.status(200).json({ message: 'Đã phê duyệt Seller thành công.', seller });
    } catch (error) {
        console.error("[approveSeller] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server khi phê duyệt seller." });
    }
};

// Từ chối một tài khoản Seller
exports.rejectSeller = async (req, res) => {
    try {
        const { sellerId } = req.params;
        const { reason } = req.body;

        if (!reason || reason.trim() === '') {
            return res.status(400).json({ message: 'Vui lòng cung cấp lý do từ chối.' });
        }

        const seller = await User.findOneAndUpdate(
            { _id: sellerId, role: 'seller', approvalStatus: 'pending' },
            { $set: { approvalStatus: 'rejected', rejectionReason: reason } },
            { new: true }
        );

        if (!seller) {
            return res.status(404).json({ message: 'Không tìm thấy Seller đang chờ duyệt với ID này.' });
        }

        // (Tùy chọn) Gửi thông báo cho Seller rằng tài khoản của họ đã bị từ chối kèm lý do

        res.status(200).json({ message: 'Đã từ chối Seller.', seller });
    } catch (error) {
        console.error("[rejectSeller] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server khi từ chối seller." });
    }
};


exports.getShipperComprehensiveFinancials = async (req, res) => {
    try {
        const { shipperId } = req.params;
        const shipperObjectId = new mongoose.Types.ObjectId(shipperId);

        // Lấy thông tin cơ bản của shipper, bao gồm cả thông tin ngân hàng
        const shipper = await User.findById(shipperId).select('name phone paymentInfo').lean();
        if (!shipper) {
            return res.status(404).json({ message: "Không tìm thấy shipper." });
        }

        const todayStart = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();
        const monthStart = moment().tz('Asia/Ho_Chi_Minh').startOf('month').toDate();
        const monthEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('month').toDate();

        const [
            allTimeStats,
            todayIncome,
            thisMonthIncome,
            totalSalaryPaid,
        ] = await Promise.all([
            // 1. Thống kê toàn bộ thời gian (COD và Thu nhập)
            Order.aggregate([
                { $match: { shipper: shipperObjectId, status: 'Đã giao' } },
                { 
                    $group: { 
                        _id: null, 
                        totalCodCollected: { $sum: '$total' },
                        totalIncome: { $sum: '$shipperIncome' }
                    } 
                }
            ]),
            // 2. Thu nhập ngày hôm nay
            Order.aggregate([
                { $match: { shipper: shipperObjectId, status: 'Đã giao', 'timestamps.deliveredAt': { $gte: todayStart, $lte: todayEnd } } },
                { $group: { _id: null, income: { $sum: '$shipperIncome' } } }
            ]),
            // 3. Thu nhập tháng này
            Order.aggregate([
                { $match: { shipper: shipperObjectId, status: 'Đã giao', 'timestamps.deliveredAt': { $gte: monthStart, $lte: monthEnd } } },
                { $group: { _id: null, income: { $sum: '$shipperIncome' } } }
            ]),
            // 4. Tổng lương đã trả (toàn bộ thời gian)
            SalaryPayment.aggregate([
                { $match: { shipper: shipperObjectId } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
        ]);

        // 5. Tổng COD đã nộp (toàn bộ thời gian)
        const totalCodPaidResult = await Remittance.aggregate([
            { $match: { shipper: shipperObjectId, status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const totalCodCollected = allTimeStats[0]?.totalCodCollected || 0;
        const totalShipperIncome = allTimeStats[0]?.totalIncome || 0;
        const totalCodPaid = totalCodPaidResult[0]?.total || 0;
        const totalSalaryPaidAmount = totalSalaryPaid[0]?.total || 0;
        
        const finalData = {
            shipperInfo: shipper,
            allTime: {
                totalCodCollected,
                totalCodPaid,
                totalDebt: totalCodCollected - totalCodPaid,
                totalShipperIncome,
                totalSalaryPaid: totalSalaryPaidAmount,
                remainingSalary: totalShipperIncome - totalSalaryPaidAmount,
            },
            today: {
                income: todayIncome[0]?.income || 0,
            },
            thisMonth: {
                income: thisMonthIncome[0]?.income || 0,
            }
        };

        res.status(200).json(finalData);

    } catch (error) {
        console.error('[getShipperComprehensiveFinancials] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy dữ liệu tài chính.' });
    }
};


exports.getAdminDashboardCounts = async (req, res) => {
    try {
        const [
            pendingSellers,
            pendingProducts,
            pendingPayouts,
            pendingRemittances
        ] = await Promise.all([
            User.countDocuments({ role: 'seller', approvalStatus: 'pending' }),
            Product.countDocuments({ approvalStatus: 'pending_approval' }),
            Payout.countDocuments({ status: 'pending' }),
            RemittanceRequest.countDocuments({ status: 'pending' })
        ]);

        res.status(200).json({
            pendingSellers,
            pendingProducts,
            pendingPayouts,
            pendingRemittances
        });
    } catch (error) {
        console.error('[getAdminDashboardCounts] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy số liệu dashboard' });
    }
};


// <<< HÀM MỚI: ADMIN NHẮC SHIPPER NỘP TIỀN COD >>>
exports.remindShipperToPayDebt = async (req, res) => {
    try {
        const { shipperId } = req.params;
        const { amount, message } = req.body; // Nhận số tiền và nội dung tin nhắn từ client

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Công nợ không hợp lệ để nhắc." });
        }

        const shipper = await User.findById(shipperId).select('fcmToken');
        if (!shipper) {
            return res.status(404).json({ message: "Không tìm thấy shipper." });
        }

        const notificationTitle = "Yêu cầu nộp tiền COD";
        // Nội dung tin nhắn có thể tùy chỉnh hoặc dùng mặc định
        const notificationBody = message || `Admin yêu cầu bạn nộp khoản công nợ COD còn lại là ${amount.toLocaleString('vi-VN')}đ. Vui lòng hoàn tất sớm.`;

        // 1. Gửi thông báo đẩy (Push Notification)
        if (shipper.fcmToken) {
            await safeNotify(shipper.fcmToken, {
                title: notificationTitle,
                body: notificationBody,
                data: { 
                    type: 'finance_reminder', // Một type để app shipper có thể xử lý đặc biệt nếu cần
                    screen: 'Report' // Gợi ý app shipper mở màn hình Báo cáo
                }
            });
        }

        // 2. Lưu thông báo vào cơ sở dữ liệu để shipper xem lại
        await Notification.create({
            user: shipperId,
            title: notificationTitle,
            message: notificationBody,
            type: 'finance' // Phân loại thông báo là tài chính
        });

        res.status(200).json({ message: "Đã gửi nhắc nhở thành công!" });

    } catch (error) {
        console.error('[remindShipperToPayDebt] Lỗi:', error);
        res.status(500).json({ message: "Lỗi server khi gửi nhắc nhở." });
    }
};
