const Order = require('../models/Order');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Remittance = require('../models/Remittance');
const bcrypt = require('bcrypt');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const { safeNotify } = require('../utils/notificationMiddleware');
const RemittanceRequest = require('../models/RemittanceRequest');
const SalaryPayment = require('../models/SalaryPayment'); // THÊM DÒNG NÀY

exports.updateLocation = async (req, res) => {
    try {
        const { latitude, longitude } = req.body;
        const nowVNDateObj = new Date(Date.now() + (7 * 60 * 60 * 1000));
        await User.findByIdAndUpdate(req.user._id, {
            $set: {
                location: { type: 'Point', coordinates: [longitude, latitude] },
                locationUpdatedAt: nowVNDateObj,
                isAvailable: true
            }
        });
        res.json({ message: 'Cập nhật vị trí thành công' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi cập nhật vị trí: ' + error.message });
    }
};

exports.getAssignedOrders = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, from, to, search } = req.query;
        const filter = { shipper: req.user._id };

        if (status && status !== 'all') filter.status = status;
        if (from && to) filter['timestamps.acceptedAt'] = { $gte: new Date(from), $lte: new Date(to) };
        if (search && search.trim()) {
            const regex = new RegExp(search.trim(), 'i');
            filter.$or = [{ phone: regex }, { customerName: regex }, { 'items.name': regex }];
        }

        const result = await Order.paginate(filter, {
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            sort: { 'timestamps.createdAt': -1 }
        });

        return res.json({
            orders: result.docs.map(d => ({ ...d.toObject(), timestamps: d.timestamps })),
            totalPages: result.totalPages,
            currentPage: result.page
        });
    } catch (error) {
        return res.status(500).json({ message: 'Lỗi server khi lấy đơn hàng đã gán' });
    }
};

exports.getShipperStats = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const allAssignedOrders = await Order.find({ shipper: shipperId });
        const totalOrders = allAssignedOrders.length;
        const completedOrders = allAssignedOrders.filter(order => order.status === 'Đã giao');
        const { totalIncome } = completedOrders.reduce((acc, order) => {
            acc.totalIncome += order.shipperIncome || 0;
            return acc;
        }, { totalIncome: 0 });

        res.json({
            totalOrders: totalOrders,
            completedOrders: completedOrders.length,
            revenue: totalIncome,
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi lấy thống kê shipper' });
    }
};

exports.getOrderCounts = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const counts = await Order.aggregate([
            { $match: { shipper: req.user._id } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
        ]);
        const result = { total: 0, 'Đang xử lý': 0, 'Đang giao': 0, 'Đã giao': 0, 'Đã huỷ': 0 };
        counts.forEach(item => {
            if (result.hasOwnProperty(item._id)) result[item._id] = item.count;
        });
        result.total = counts.reduce((sum, item) => sum + item.count, 0);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi đếm đơn hàng' });
    }
};

exports.addSurcharge = async (req, res) => {
    try {
        const { amount } = req.body;
        const orderId = req.params.id;
        if (typeof amount !== 'number' || amount < 0) return res.status(400).json({ message: 'Số tiền phụ phí không hợp lệ.' });
        const order = await Order.findOne({ _id: orderId, shipper: req.user._id });
        if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng hoặc bạn không phải shipper của đơn này.' });
        if (order.status !== 'Đang giao') return res.status(400).json({ message: 'Chỉ có thể thêm phụ phí cho đơn hàng đang giao.' });
        order.extraSurcharge = (order.extraSurcharge || 0) + amount;
        order.total = order.total + amount;
        const updatedOrder = await order.save();
        res.status(200).json({ message: 'Thêm phụ phí thành công!', order: updatedOrder });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server: ' + error.message });
    }
};

exports.getShipperNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({ user: req.user._id }).sort('-createdAt').limit(20);
        res.json(notifications);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi khi lấy thông báo: ' + error.message });
    }
};

exports.updateFcmToken = async (req, res) => {
    try {
        const { fcmToken } = req.body;
        if (!fcmToken) return res.status(400).json({ message: 'Thiếu fcmToken' });
        const updatedShipper = await User.findByIdAndUpdate(req.user._id, { fcmToken }, { new: true });
        res.json({ message: 'Cập nhật FCM token thành công', fcmToken: updatedShipper.fcmToken });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server: ' + error.message });
    }
};

exports.changePassword = async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
        const user = await User.findById(req.user._id).select('+password');
        if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
            return res.status(401).json({ message: 'Mật khẩu hiện tại không đúng' });
        }
        user.password = newPassword;
        await user.save();
        res.json({ message: 'Đổi mật khẩu thành công' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server: ' + error.message });
    }
};

exports.getDashboardSummary = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const todayStart = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();

        const [dailyStats, remittanceTodayResult, processingOrders, notifications, pendingRequest] = await Promise.all([
            Order.aggregate([
                {
                    $match: {
                        shipper: new mongoose.Types.ObjectId(shipperId),
                        status: 'Đã giao',
                        'timestamps.deliveredAt': { $gte: todayStart, $lte: todayEnd }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalCOD: { $sum: '$total' },
                        totalIncome: { $sum: '$shipperIncome' },
                        completedOrders: { $sum: 1 }
                    }
                }
            ]),
            Remittance.find({
                shipper: shipperId,
                remittanceDate: { $gte: todayStart, $lte: todayEnd },
                status: 'completed'
            }).lean(),
            Order.countDocuments({
                shipper: shipperId,
                status: { $in: ['Đang xử lý', 'Đang giao'] }
            }).lean(),
            Notification.find({ user: shipperId }).sort({ createdAt: -1 }).limit(5).lean(), 
            RemittanceRequest.findOne({ shipper: shipperId, status: 'pending' }).lean()
        ]);

        const stats = dailyStats[0] || { totalCOD: 0, totalIncome: 0, completedOrders: 0 };
        const amountRemittedToday = remittanceTodayResult.reduce((sum, remit) => sum + (remit.amount || 0), 0);
        const amountToRemitToday = stats.totalCOD - amountRemittedToday;

        res.status(200).json({
            remittance: {
                amountToRemit: amountToRemitToday > 0 ? amountToRemitToday : 0,
                completedOrders: stats.completedOrders,
                totalShipperIncome: stats.totalIncome
            },
            // <<< TRẢ VỀ ĐÚNG DỮ LIỆU NOTIFICATIONS >>>
            notifications: notifications, // Dữ liệu giờ đã có ở đây
            processingOrderCount: processingOrders,
            hasPendingRequest: !!pendingRequest
        });
    } catch (error) {
        console.error('[getDashboardSummary] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy dữ liệu dashboard.' });
    }
};

exports.createRemittanceRequest = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const { amount, notes, isForOldDebt = false } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ message: "Số tiền yêu cầu không hợp lệ." });
        const existingPending = await RemittanceRequest.findOne({ shipper: shipperId, status: 'pending' });
        if (existingPending) return res.status(400).json({ message: "Bạn đã có một yêu cầu đang chờ xử lý. Vui lòng đợi Admin xác nhận trước khi tạo yêu cầu mới." });
        const newRequest = new RemittanceRequest({ shipper: shipperId, amount, shipperNotes: notes || `Yêu cầu nộp tiền lúc ${new Date().toLocaleString('vi-VN')}`, isForOldDebt });
        await newRequest.save();
        res.status(201).json({ message: "Yêu cầu đã được gửi. Vui lòng chờ admin xác nhận." });
    } catch (error) {
        console.error('[createRemittanceRequest] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

// ==========================================================
// === GET MONTHLY REPORT - SỬA LẠI ĐỂ THÊM DỮ LIỆU LƯƠNG ===
// ==========================================================
exports.getMonthlyFinancialReport = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ message: "Vui lòng cung cấp tháng và năm." });

        const targetMonth = parseInt(month);
        const targetYear = parseInt(year);
        
        // <<< SỬA ĐỔI PROMISE.ALL TẠI ĐÂY >>>
        const [dailyBreakdown, remittances, salaryPayments, pendingRequest] = await Promise.all([
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
                        day: { $dateToString: { format: "%Y-%m-%d", date: "$timestamps.deliveredAt", timezone: "Asia/Ho_Chi_Minh" } },
                        codCollected: "$total",
                        income: "$shipperIncome"
                    }
                },
                {
                    $group: {
                        _id: "$day",
                        codCollected: { $sum: "$codCollected" },
                        income: { $sum: "$income" },
                        orderCount: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        day: "$_id",
                        codCollected: 1,
                        income: 1,
                        orderCount: 1
                    }
                }
            ]),
            Remittance.find({ shipper: shipperId, status: 'completed' }).lean(),
            // Thêm query lấy lương đã trả
            SalaryPayment.find({ 
                shipper: shipperId, 
                paymentDate: {
                    $gte: moment.tz(`${year}-${month}-01`, "YYYY-M-DD", "Asia/Ho_Chi_Minh").startOf('month').toDate(),
                    $lte: moment.tz(`${year}-${month}-01`, "YYYY-M-DD", "Asia/Ho_Chi_Minh").endOf('month').toDate()
                }
            }).lean(),
            RemittanceRequest.findOne({ shipper: shipperId, status: 'pending' }).lean()
        ]);
        
        const remittedMap = new Map();
        remittances.forEach(r => {
            remittedMap.set(moment(r.remittanceDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD'), r.amount || 0);
        });

        dailyBreakdown.forEach(item => {
            item.amountRemitted = remittedMap.get(item.day) || 0;
        });

        let totalIncomeThisMonth = 0;
        let accumulatedDebt = 0;
        const todayString = moment().tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
        
        dailyBreakdown.forEach(item => {
            const dayMoment = moment(item.day, "YYYY-MM-DD");
            if (dayMoment.month() + 1 === targetMonth && dayMoment.year() === targetYear) {
                totalIncomeThisMonth += item.income;
            }
            if (item.day < todayString) {
                accumulatedDebt += (item.codCollected - item.amountRemitted);
            }
        });
        
        const todayData = dailyBreakdown.find(item => item.day === todayString) || { codCollected: 0, amountRemitted: 0 };
        const todayDebt = todayData.codCollected - todayData.amountRemitted;
        
        // <<< TÍNH TOÁN LƯƠNG ĐÃ NHẬN >>>
        const totalSalaryPaid = salaryPayments.reduce((sum, payment) => sum + payment.amount, 0);

        const filteredBreakdown = dailyBreakdown
            .filter(item => {
                const dayMoment = moment(item.day, "YYYY-MM-DD");
                return dayMoment.month() + 1 === targetMonth && dayMoment.year() === targetYear;
            })
            .sort((a, b) => b.day.localeCompare(a.day));

        res.status(200).json({
            overview: {
                totalDebt: accumulatedDebt > 0 ? accumulatedDebt : 0,
                todayDebt: todayDebt > 0 ? todayDebt : 0,
                totalIncome: totalIncomeThisMonth,
                totalSalaryPaid: totalSalaryPaid // <<< THÊM TRƯỜNG NÀY VÀO RESPONSE
            },
            dailyBreakdown: filteredBreakdown,
            hasPendingRequest: !!pendingRequest
        });
    } catch (error) {
        console.error('[getMonthlyFinancialReport] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy báo cáo.' });
    }
};

exports.confirmRemittance = async (req, res) => {
    // This function is deprecated
    return res.status(410).json({ message: "This endpoint is deprecated." });
};

exports.sendCODRemittanceReminder = async () => {
    console.log("CRON JOB: Bắt đầu gửi thông báo nhắc nộp tiền COD...");
    try {
        const todayStart = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();

        const activeShippers = await Order.distinct('shipper', { status: 'Đã giao', 'timestamps.deliveredAt': { $gte: todayStart, $lte: todayEnd } });
        if (activeShippers.length === 0) { console.log("CRON JOB: Không có shipper nào hoạt động hôm nay."); return; }

        for (const shipperId of activeShippers) {
            const shipper = await User.findById(shipperId);
            if (!shipper || !shipper.fcmToken) continue;

            const orders = await Order.find({ shipper: shipperId, status: 'Đã giao', 'timestamps.deliveredAt': { $gte: todayStart, $lte: todayEnd } });
            const totalCOD = orders.reduce((sum, order) => sum + order.total, 0);
            const remittance = await Remittance.findOne({ shipper: shipperId, remittanceDate: { $gte: todayStart, $lte: todayEnd }, status: 'completed' });
            const amountRemitted = remittance ? remittance.amount : 0;
            const amountToRemit = totalCOD - amountRemitted;

            if (amountToRemit > 0) {
                const message = `Bạn cần nộp ${amountToRemit.toLocaleString()}đ tiền thu hộ (COD) cho ngày hôm nay. Vui lòng hoàn thành trước khi bắt đầu ca làm việc tiếp theo.`;
                await safeNotify(shipper.fcmToken, { title: '📢 Nhắc nhở nộp tiền COD', body: message, data: { type: 'remittance_reminder' } });
                await Notification.create({ user: shipperId, title: 'Nhắc nhở nộp tiền COD', message, type: 'finance' });
                console.log(`CRON JOB: Đã gửi thông báo cho shipper ${shipperId} số tiền ${amountToRemit}`);
            }
        }
        console.log("CRON JOB: Hoàn thành gửi thông báo.");
    } catch (error) {
        console.error("CRON JOB ERROR: Lỗi khi gửi thông báo nhắc nợ:", error);
    }
};
