const User = require('../models/User');
const Remittance = require('../models/Remittance');
const Order = require('../models/Order');
const moment = require('moment-timezone');
const SalaryPayment = require('../models/SalaryPayment');
const mongoose = require('mongoose');

// API để lấy danh sách tất cả các shipper và công nợ của họ

exports.getShipperDebtOverview = async (req, res) => {
    try {
        // 1. Lấy tất cả các user có vai trò là shipper
        const shippers = await User.find({ role: 'shipper' }).select('name phone').lean();

        // 2. Lấy tất cả các yêu cầu nộp tiền đang chờ xử lý
        const pendingRequests = await RemittanceRequest.find({ status: 'pending' }).lean();
        const pendingRequestMap = new Map();
        pendingRequests.forEach(req => {
            const shipperId = req.shipper.toString();
            if (!pendingRequestMap.has(shipperId)) {
                pendingRequestMap.set(shipperId, []);
            }
            pendingRequestMap.get(shipperId).push(req);
        });

        // 3. Tính công nợ cho từng shipper
        const debtData = await Promise.all(shippers.map(async (shipper) => {
            // Lấy tổng COD và tổng đã nộp của mỗi shipper
            const [codResult, remittedResult] = await Promise.all([
                Order.aggregate([
                    { $match: { shipper: shipper._id, status: 'Đã giao' } },
                    { $group: { _id: null, total: { $sum: '$total' } } }
                ]),
                // Chỉ tính các khoản nộp tiền đã được 'completed'
                Remittance.aggregate([
                    { $match: { shipper: shipper._id, status: 'completed' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ])
            ]);

            const totalCOD = codResult[0]?.total || 0;
            const totalRemitted = remittedResult[0]?.total || 0;
            const totalDebt = totalCOD - totalRemitted;

            return {
                ...shipper,
                totalDebt: totalDebt > 0 ? totalDebt : 0,
                pendingRequests: pendingRequestMap.get(shipper._id.toString()) || [] // Lấy các yêu cầu đang chờ của shipper này
            };
        }));
        
        // Sắp xếp shipper có nợ cao nhất hoặc có yêu cầu chờ xử lý lên đầu
        debtData.sort((a, b) => {
            if (b.pendingRequests.length > a.pendingRequests.length) return 1;
            if (b.pendingRequests.length < a.pendingRequests.length) return -1;
            return b.totalDebt - a.totalDebt;
        });

        res.status(200).json(debtData);
    } catch (error) {
        console.error("[getShipperDebtOverview] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
};
// API mới: Lấy các yêu cầu đang chờ
exports.getPendingRemittanceRequests = async (req, res) => {
    try {
        const requests = await RemittanceRequest.find({ status: 'pending' }).populate('shipper', 'name phone').sort({ createdAt: -1 });
        res.status(200).json(requests);
    } catch (error) { res.status(500).json({ message: "Lỗi server" }); }
};

// API mới: Đếm số yêu cầu đang chờ
exports.countPendingRemittanceRequests = async (req, res) => {
    try {
        const count = await RemittanceRequest.countDocuments({ status: 'pending' });
        res.status(200).json({ count });
    } catch (error) { res.status(500).json({ message: "Lỗi server" }); }
};

// API mới: Admin duyệt yêu cầu
exports.processRemittanceRequest = async (req, res) => {
    const { requestId } = req.params;
    const { action, adminNotes } = req.body; // 'approve' hoặc 'reject'
    const adminId = req.user._id;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const request = await RemittanceRequest.findById(requestId).session(session);
        if (!request || request.status !== 'pending') {
            throw new Error("Yêu cầu không hợp lệ hoặc đã được xử lý.");
        }

        if (action === 'approve') {
            let amountToApply = request.amount;
            
            // <<< LOGIC PHÂN BỔ TIỀN VÀO CÁC NGÀY NỢ CŨ >>>
            // (giữ nguyên logic từ hàm confirmRemittance cũ)
            // Tìm các ngày còn nợ, trừ dần từ cũ đến mới...
            const orders = await Order.find({ shipper: request.shipper, status: 'Đã giao' }).sort({ 'timestamps.deliveredAt': 1 }).session(session);
            const allRemittances = await Remittance.find({ shipper: request.shipper }).session(session);
            // ...
            for (const day of sortedDebtDays) {
                // ...
                await Remittance.findOneAndUpdate(
                    { shipper: request.shipper, remittanceDate: ... },
                    { $inc: { amount: payment }, ... },
                    { upsert: true, session: session }
                );
                amountToApply -= payment;
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
        res.status(200).json({ message: `Đã ${action} yêu cầu thành công.` });
    } catch (error) {
        await session.abortTransaction();
        console.error("[processRemittanceRequest] Lỗi:", error);
        res.status(500).json({ message: error.message });
    } finally {
        session.endSession();
    }
};


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

        // (Tùy chọn) Gửi thông báo cho shipper rằng họ đã nhận được lương
        
        res.status(201).json({ message: 'Thanh toán lương thành công!', payment: newPayment });

    } catch (error) {
        console.error('[payShipperSalary] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi thanh toán lương.' });
    }
};

// API để lấy toàn bộ thông tin tài chính của shipper trong tháng
exports.getShipperFinancialDetails = async (req, res) => {
    try {
        const { shipperId } = req.params;
        const { month, year } = req.query; // Lấy tháng/năm từ query params

        if (!month || !year) {
            return res.status(400).json({ message: "Vui lòng cung cấp tháng và năm." });
        }
        
        const startDate = moment.tz(`${year}-${month}-01`, "YYYY-M-DD", "Asia/Ho_Chi_Minh").startOf('month').toDate();
        const endDate = moment(startDate).endOf('month').toDate();

        const [incomeResult, paymentResult, remittances] = await Promise.all([
            // 1. Tính tổng thu nhập (shipperIncome) trong tháng
            Order.aggregate([
                {
                    $match: {
                        shipper: new mongoose.Types.ObjectId(shipperId),
                        status: 'Đã giao',
                        'timestamps.deliveredAt': { $gte: startDate, $lte: endDate }
                    }
                },
                { $group: { _id: null, totalIncome: { $sum: '$shipperIncome' } } }
            ]),
            // 2. Tính tổng lương đã trả cho tháng đó
            SalaryPayment.aggregate([
                {
                    $match: {
                        shipper: new mongoose.Types.ObjectId(shipperId),
                        paymentDate: { $gte: startDate, $lte: endDate }
                    }
                },
                { $group: { _id: null, totalPaid: { $sum: '$amount' } } }
            ]),
            // 3. Lấy lịch sử nộp tiền COD (giữ lại chức năng cũ)
            Remittance.find({ shipper: shipperId, status: 'completed' }).sort({ remittanceDate: -1 })
        ]);
        
        const totalIncome = incomeResult[0]?.totalIncome || 0;
        const totalSalaryPaid = paymentResult[0]?.totalPaid || 0;

        res.status(200).json({
            totalIncome: totalIncome,
            totalSalaryPaid: totalSalaryPaid,
            remittances: remittances // Lịch sử nộp tiền COD
        });

    } catch (error) {
        console.error('[getShipperFinancialDetails] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};
