const User = require('../models/User');
const Remittance = require('../models/Remittance');
const Order = require('../models/Order');
const moment = require('moment-timezone');

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
