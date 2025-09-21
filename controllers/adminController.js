// controllers/adminController.js

const User = require('../models/User');
const Region = require('../models/Region');
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

exports.getFinancialOverview = async (req, res) => {
    try {
        // --- 1. TÍNH TOÁN DOANH THU, LỢI NHUẬN VÀ CHI PHÍ TỪ CÁC ĐƠN HÀNG ĐÃ GIAO ---
        const orderFinancials = await Order.aggregate([
            { $match: { status: 'Đã giao' } },
            {
                $project: {
                    deliveredAt: '$timestamps.deliveredAt',
                    totalRevenue: '$total', // Tổng tiền THU TỪ KHÁCH (đã trừ voucher)
                    totalShipperIncome: '$shipperIncome',
                    
                    // <<< THÊM CÁC TRƯỜNG CẦN THIẾT ĐỂ TÍNH TOÁN CHÍNH XÁC >>>
                    shippingFeeActual: { $ifNull: ['$shippingFeeActual', 0] },
                    extraSurcharge: { $ifNull: ['$extraSurcharge', 0] },
                    voucherDiscount: { $ifNull: ['$voucherDiscount', 0] },
                    
                    itemsTotal: {
                        $reduce: {
                            input: '$items',
                            initialValue: 0,
                            in: { $add: ['$$value', { $multiply: ['$$this.price', '$$this.quantity'] }] }
                        }
                    },
                    totalCommission: {
                        $reduce: {
                            input: '$items',
                            initialValue: 0,
                            in: { $add: ['$$value', '$$this.commissionAmount'] }
                        }
                    }
                }
            },
            {
                $project: {
                    deliveredAt: 1,
                    // Doanh thu gộp = Tiền hàng + Phí ship thực tế + Phụ phí
                    grossRevenue: { $add: ['$itemsTotal', '$shippingFeeActual', '$extraSurcharge'] },
                    
                    // Lợi nhuận gộp = (Doanh thu gộp) - (Tiền trả seller) - (Tiền trả shipper) - (Tiền trợ giá voucher)
                    // Tiền trả seller = itemsTotal - totalCommission
                    grossProfit: {
                        $subtract: [
                            { $add: ['$itemsTotal', '$shippingFeeActual', '$extraSurcharge'] }, // Doanh thu gộp
                            { 
                                $add: [
                                    { $subtract: ['$itemsTotal', '$totalCommission'] }, // Tiền trả seller
                                    '$totalShipperIncome', // Tiền trả shipper
                                    '$voucherDiscount' // Chi phí voucher
                                ] 
                            }
                        ]
                    },
                    voucherCost: '$voucherDiscount' // Giữ lại chi phí voucher để thống kê
                }
            }
        ]);
        
        // --- 2. TÍNH TOÁN TỔNG LƯƠNG CỨNG ĐÃ TRẢ ---
        const totalHardSalaryPaidResult = await SalaryPayment.aggregate([
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalHardSalaryPaid = totalHardSalaryPaidResult[0]?.total || 0;

        // --- 3. TÍNH TOÁN TỔNG COD ĐÃ THU ---
        const totalCodResult = await Order.aggregate([
            { $match: { status: 'Đã giao', paymentMethod: 'COD' } },
            { $group: { _id: null, total: { $sum: '$total' } } }
        ]);
        const totalCodCollected = totalCodResult[0]?.total || 0;

        // --- 4. TÍNH TOÁN CÔNG NỢ PHẢI THU TỪ SHIPPER ---
        const shipperDebtResult = await Order.aggregate([
            { $match: { status: 'Đã giao', paymentMethod: 'COD' } },
            { $group: { _id: '$shipper', totalCodCollected: { $sum: '$total' } } },
            { $lookup: { from: 'remittances', localField: '_id', foreignField: 'shipper', as: 'remittances' } },
            { $project: { shipperId: '$_id', debt: { $subtract: ['$totalCodCollected', { $sum: '$remittances.amount' }] } } },
            { $group: { _id: null, totalDebtToCollect: { $sum: { $max: [0, '$debt'] } } } }
        ]);
        const totalCodDebt = shipperDebtResult[0]?.totalDebtToCollect || 0;

        // --- 5. TÍNH TOÁN CÔNG NỢ PHẢI TRẢ CHO SELLER ---
        const sellerLiabilityResult = await User.aggregate([
            { $match: { role: 'seller', approvalStatus: 'approved' } },
            { $lookup: { from: 'ledgerentries', localField: '_id', foreignField: 'seller', pipeline: [ { $sort: { createdAt: -1 } }, { $limit: 1 } ], as: 'lastLedgerEntry' } },
            { $unwind: { path: '$lastLedgerEntry', preserveNullAndEmptyArrays: true } },
            { $group: { _id: null, totalBalanceToPay: { $sum: '$lastLedgerEntry.balanceAfter' } } }
        ]);
        const totalSellerLiability = sellerLiabilityResult[0]?.totalBalanceToPay || 0;

        // --- 6. TỔNG HỢP DỮ LIỆU THEO NGÀY, THÁNG, NĂM ---
        const today = moment().tz('Asia/Ho_Chi_Minh');
        const thisMonth = today.month();
        const thisYear = today.year();
        const todayStr = today.format('YYYY-MM-DD');

        let daily = { revenue: 0, profit: 0, voucherCost: 0 };
        let monthly = { revenue: 0, profit: 0, voucherCost: 0 };
        let yearly = { revenue: 0, profit: 0, voucherCost: 0 };
        let allTime = { revenue: 0, profit: 0, voucherCost: 0 };

        orderFinancials.forEach(order => {
            const date = moment(order.deliveredAt).tz('Asia/Ho_Chi_Minh');
            const orderRevenue = order.grossRevenue || 0; // Dùng doanh thu gộp
            const orderProfit = order.grossProfit || 0;
            const orderVoucherCost = order.voucherCost || 0;
            
            allTime.revenue += orderRevenue;
            allTime.profit += orderProfit;
            allTime.voucherCost += orderVoucherCost;

            if (date.year() === thisYear) {
                yearly.revenue += orderRevenue;
                yearly.profit += orderProfit;
                yearly.voucherCost += orderVoucherCost;
            }
            if (date.year() === thisYear && date.month() === thisMonth) {
                monthly.revenue += orderRevenue;
                monthly.profit += orderProfit;
                monthly.voucherCost += orderVoucherCost;
            }
            if (date.format('YYYY-MM-DD') === todayStr) {
                daily.revenue += orderRevenue;
                daily.profit += orderProfit;
                daily.voucherCost += orderVoucherCost;
            }
        });
        
        // Trừ đi lương cứng đã trả để có lợi nhuận ròng
        allTime.netProfit = allTime.profit - totalHardSalaryPaid;

        res.status(200).json({
            summary: {
                totalCodCollected: totalCodCollected,
                totalCodDebtToCollect: totalCodDebt,
                totalSellerLiabilityToPay: totalSellerLiability,
                netProfitAllTime: allTime.netProfit,
                totalVoucherCost: allTime.voucherCost,
            },
            revenueAndProfit: {
                today: daily,
                thisMonth: monthly,
                thisYear: yearly,
                allTime: { revenue: allTime.revenue, profit: allTime.profit, voucherCost: allTime.voucherCost }
            }
        });
    } catch (error) {
        console.error("[getFinancialOverview] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server khi lấy tổng quan tài chính." });
    }
};

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
        const request = await RemittanceRequest.findById(requestId)
            .populate('shipper', 'fcmToken name') // << THÊM populate('shipper')
            .session(session);
            
        if (!request || request.status !== 'pending') {
            throw new Error("Yêu cầu không hợp lệ hoặc đã được xử lý.");
        }
        
        let notificationTitle = '';
        let notificationBody = '';

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
            notificationTitle = "Yêu cầu nộp tiền đã được duyệt";
            notificationBody = `Yêu cầu xác nhận nộp ${request.amount.toLocaleString()}đ của bạn đã được Admin chấp nhận.`;
        } else if (action === 'reject') {
            request.status = 'rejected';
            notificationTitle = "Yêu cầu nộp tiền bị từ chối";
            notificationBody = `Yêu cầu xác nhận nộp ${request.amount.toLocaleString()}đ của bạn đã bị từ chối. Lý do: ${adminNotes || 'Không có ghi chú'}`;
        } else {
            throw new Error("Hành động không hợp lệ.");
        }

        request.adminNotes = adminNotes;
        request.processedAt = new Date();
        request.approvedBy = adminId;
        await request.save({ session });
        
        await session.commitTransaction(); // Commit trước khi gửi thông báo

        // --- BẮT ĐẦU LOGIC GỬI THÔNG BÁO CHO SHIPPER ---
        // Chạy bất đồng bộ để không làm chậm response trả về cho Admin
        (async () => {
            try {
                const shipper = request.shipper;
                if (shipper) {
                    // 1. Lưu vào DB
                    await Notification.create({
                        user: shipper._id,
                        title: notificationTitle,
                        message: notificationBody,
                        type: 'finance', // Hoặc 'remittance' nếu bạn muốn
                        data: {
                            screen: 'Report', // Gợi ý mở màn hình báo cáo
                            remittanceRequestId: request._id.toString()
                        }
                    });

                    // 2. Gửi Push Notification
                    if (shipper.fcmToken) {
                        await safeNotify(shipper.fcmToken, {
                            title: notificationTitle,
                            body: notificationBody,
                            data: {
                                type: 'remittance_processed',
                                screen: 'Report'
                            }
                        });
                    }
                }
            } catch(e) {
                console.error("Lỗi khi gửi thông báo xử lý nộp tiền cho shipper:", e);
            }
        })();
        // --- KẾT THÚC LOGIC ---
        
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
        const { amount, notes } = req.body;
        const adminId = req.user._id;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Số tiền thanh toán không hợp lệ." });
        }
        
        const paymentDate = new Date();

        const newPayment = new SalaryPayment({
            shipper: shipperId,
            amount: amount,
            paymentDate: paymentDate,
            paidBy: adminId,
            notes: notes
        });

        await newPayment.save();
        
        // --- BẮT ĐẦU LOGIC GỬI THÔNG BÁO ---
        (async () => {
            try {
                const shipper = await User.findById(shipperId).select('fcmToken');
                if (shipper) {
                    const title = "Bạn vừa nhận được lương";
                    const body = `Admin đã thanh toán lương cho bạn số tiền ${amount.toLocaleString('vi-VN')}đ.`;
                    
                    // 1. Lưu vào DB
                    await Notification.create({
                        user: shipperId,
                        title: title,
                        message: body,
                        type: 'finance', // Dùng chung type finance
                        data: { 
                            screen: 'Report', // Gợi ý mở màn hình báo cáo
                            salaryAmount: amount 
                        }
                    });
                    
                    // 2. Gửi Push Notification
                    if (shipper.fcmToken) {
                        await safeNotify(shipper.fcmToken, {
                            title,
                            body,
                            data: { 
                                type: 'salary_received',
                                screen: 'Report'
                            }
                        });
                    }
                }
            } catch (notificationError) {
                console.error("[payShipperSalary] Lỗi khi gửi thông báo:", notificationError);
            }
        })();
        // --- KẾT THÚC LOGIC ---
        
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

        await LedgerEntry.create({
            seller: sellerId,
            type: 'debit',
            amount,
            description: notes || `Admin thanh toán cho bạn`,
            balanceAfter: newBalance,
        });

        // --- BẮT ĐẦU LOGIC GỬI THÔNG BÁO ---
        (async () => {
            try {
                const seller = await User.findById(sellerId).select('fcmToken');
                if (seller) {
                    const title = "Bạn vừa nhận được thanh toán";
                    const body = `Admin đã thanh toán cho bạn số tiền ${amount.toLocaleString('vi-VN')}đ. Số dư của bạn đã được cập nhật.`;
                    
                    // 1. Lưu vào DB
                    await Notification.create({
                        user: sellerId,
                        title: title,
                        message: body,
                        type: 'payout', // Type riêng cho thanh toán
                        data: { 
                            screen: 'Finance', // Gợi ý mở màn hình tài chính
                            payoutAmount: amount 
                        }
                    });
                    
                    // 2. Gửi Push Notification
                    if (seller.fcmToken) {
                        await safeNotify(seller.fcmToken, {
                            title,
                            body,
                            data: { 
                                type: 'payout_received',
                                screen: 'Finance' 
                            }
                        });
                    }
                }
            } catch (notificationError) {
                console.error("[payToSeller] Lỗi khi gửi thông báo:", notificationError);
            }
        })();
        // --- KẾT THÚC LOGIC ---

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
        const { regionId } = req.body;
        if (!regionId) {
            return res.status(400).json({ message: 'Vui lòng chọn một khu vực cho Seller.' });
        }
        const seller = await User.findOneAndUpdate(
            { _id: sellerId, role: 'seller', approvalStatus: 'pending' },
            { $set: { approvalStatus: 'approved', region: regionId } },
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


exports.getRegionManagers = async (req, res) => {
    try {
        const managers = await User.find({ role: 'region_manager' })
            .populate('region', 'name') // Lấy tên khu vực họ quản lý
            .select('name email phone region regionManagerProfile'); // Chọn các trường cần thiết
        res.status(200).json(managers);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách Quản lý Vùng.' });
    }
};

// Tạo một Quản lý Vùng mới
exports.createRegionManager = async (req, res) => {
    try {
        const { name, email, password, phone, regionId, profitShareRate } = req.body;

        if (!name || !email || !password || !phone || !regionId || profitShareRate == null) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin.' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ message: 'Email này đã được sử dụng.' });
        }

        const region = await Region.findById(regionId);
        if (!region) {
            return res.status(404).json({ message: 'Khu vực được chọn không tồn tại.' });
        }
        
        const newManager = new User({
            name,
            email,
            password, // Mật khẩu sẽ tự được hash bởi middleware trong User model
            phone,
            role: 'region_manager',
            approvalStatus: 'approved', // Quản lý Vùng do Admin tạo nên được duyệt luôn
            address: region.name, // Lấy tạm địa chỉ là tên khu vực
            region: regionId,
            regionManagerProfile: {
                profitShareRate: parseFloat(profitShareRate)
            }
        });

        await newManager.save();
        res.status(201).json(newManager);

    } catch (error) {
        console.error("Lỗi khi tạo Quản lý Vùng:", error);
        res.status(500).json({ message: 'Lỗi server khi tạo Quản lý Vùng.' });
    }
};

// Cập nhật thông tin Quản lý Vùng
exports.updateRegionManager = async (req, res) => {
    try {
        const { managerId } = req.params;
        const { name, phone, regionId, profitShareRate } = req.body;

        const updateData = {};
        if (name) updateData.name = name;
        if (phone) updateData.phone = phone;
        if (regionId) updateData.region = regionId;
        if (profitShareRate != null) {
            updateData['regionManagerProfile.profitShareRate'] = parseFloat(profitShareRate);
        }

        const updatedManager = await User.findByIdAndUpdate(managerId, updateData, { new: true });

        if (!updatedManager) {
            return res.status(404).json({ message: 'Không tìm thấy Quản lý Vùng.' });
        }

        res.status(200).json(updatedManager);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi cập nhật Quản lý Vùng.' });
    }
};

exports.assignManagerToUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { managerId } = req.body; // managerId có thể là null để gỡ gán

        const userToUpdate = await User.findById(userId);
        if (!userToUpdate || !['seller', 'shipper'].includes(userToUpdate.role)) {
            return res.status(404).json({ message: 'Không tìm thấy Seller hoặc Shipper này.' });
        }

        if (managerId) {
            const manager = await User.findById(managerId);
            if (!manager || manager.role !== 'region_manager') {
                return res.status(404).json({ message: 'Người quản lý được chọn không hợp lệ.' });
            }
            // Gán người quản lý và đồng bộ khu vực
            userToUpdate.managedBy = managerId;
            userToUpdate.region = manager.region; 
        } else {
            // Gỡ gán, quay về cho Admin trung tâm quản lý
            userToUpdate.managedBy = null;
        }

        await userToUpdate.save();
        res.status(200).json({ message: 'Cập nhật người quản lý thành công!', user: userToUpdate });

    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi gán người quản lý.' });
    }
};
exports.getAllSellers = async (req, res) => {
    try {
        const query = { role: 'seller' };

        if (req.user.role === 'region_manager') {
            if (!req.user.region) {
                return res.status(403).json({ message: 'Tài khoản quản lý của bạn chưa được gán khu vực.' });
            }
            query.region = req.user.region;
        }

        const sellers = await User.find(query)
            // <<< DÒNG POPULATE NÀY LÀ CHÌA KHÓA >>>
            .populate('managedBy', 'name') // Lấy trường 'name' từ document của người quản lý
            .populate('region', 'name')
            // Lấy thêm các trường cần thiết cho hiển thị
            .select('name email commissionRate managedBy region');

        res.status(200).json(sellers);
    } catch (error) {
        console.error("Lỗi khi lấy danh sách Sellers:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách Seller.' });
    }
};
