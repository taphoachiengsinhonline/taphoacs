// controllers/adminController.js
// controllers/adminController.js

const User = require('../models/User');
const Remittance = require('../models/Remittance');
const Order = require('../models/Order');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const RemittanceRequest = require('../models/RemittanceRequest');
const SalaryPayment = require('../models/SalaryPayment');

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
        const { amount, notes, month, year } = req.body;
        const adminId = req.user._id;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Số tiền thanh toán không hợp lệ." });
        }
        if (!month || !year) {
            return res.status(400).json({ message: "Vui lòng cung cấp tháng và năm trả lương." });
        }

        const paymentDate = moment.tz(`${year}-${month}-01`, "YYYY-MM-DD", "Asia/Ho_Chi_Minh").startOf('month').toDate();

        const newPayment = new SalaryPayment({
            shipper: shipperId,
            amount: amount,
            paymentDate: paymentDate,
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
