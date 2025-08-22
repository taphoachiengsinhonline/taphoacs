const Order = require('../models/Order');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Remittance = require('../models/Remittance');
const bcrypt = require('bcryptjs'); // Sửa lại import
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const { safeNotify } = require('../utils/notificationMiddleware');
const RemittanceRequest = require('../models/RemittanceRequest');
const SalaryPayment = require('../models/SalaryPayment');

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

exports.getAllNotifications = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const notifications = await Notification.find({ user: shipperId })
            .sort({ createdAt: -1 })
            .limit(100);
        res.status(200).json(notifications);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách thông báo.' });
    }
};

exports.markNotificationAsRead = async (req, res) => {
    try {
        const { id: notificationId } = req.params;
        const shipperId = req.user._id;
        const notification = await Notification.findOneAndUpdate(
            { _id: notificationId, user: shipperId },
            { $set: { isRead: true } },
            { new: true }
        );
        if (!notification) {
            return res.status(404).json({ message: 'Không tìm thấy thông báo.' });
        }
        res.status(200).json({ message: 'Đã đánh dấu đã đọc.', notification });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi cập nhật thông báo.' });
    }
};

exports.deleteNotification = async (req, res) => {
    try {
        const { id: notificationId } = req.params;
        const shipperId = req.user._id;
        const result = await Notification.deleteOne({ _id: notificationId, user: shipperId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Không tìm thấy thông báo để xóa.' });
        }
        res.status(200).json({ message: 'Đã xóa thông báo thành công.' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi xóa thông báo.' });
    }
};

exports.getDashboardSummary = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const todayStart = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();
        const todayString = moment().tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');

        const [
            dailyStatsResult,
            remittanceTodayResult,
            processingOrders,
            unreadCount,
            latestNotification,
            pendingRequest
        ] = await Promise.all([
            Order.aggregate([
                {
                    $match: {
                        shipper: new mongoose.Types.ObjectId(shipperId),
                        status: 'Đã giao',
                        'timestamps.deliveredAt': { $gte: todayStart, $lte: todayEnd }
                    }
                },
                {
                    $project: {
                        day: { $dateToString: { format: "%Y-%m-%d", date: "$timestamps.deliveredAt", timezone: "Asia/Ho_Chi_Minh" } },
                        total: 1,
                        shipperIncome: 1
                    }
                },
                { $match: { day: todayString } },
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
            }),
            Notification.countDocuments({ user: shipperId, isRead: false }),
            Notification.findOne({ user: shipperId }).sort({ createdAt: -1 }).lean(),
            RemittanceRequest.findOne({ shipper: shipperId, status: 'pending' }).lean()
        ]);

        const stats = dailyStatsResult[0] || { totalCOD: 0, totalIncome: 0, completedOrders: 0 };
        const amountRemittedToday = remittanceTodayResult.reduce((sum, remit) => sum + (remit.amount || 0), 0);
        const amountToRemitToday = stats.totalCOD - amountRemittedToday;

        res.status(200).json({
            remittance: {
                amountToRemit: amountToRemitToday > 0 ? amountToRemitToday : 0,
                completedOrders: stats.completedOrders,
                totalShipperIncome: stats.totalIncome
            },
            notificationSummary: {
                unreadCount: unreadCount,
                latestNotification: latestNotification
            },
            processingOrderCount: processingOrders,
            hasPendingRequest: !!pendingRequest
        });
    } catch (error) {
        console.error('[getDashboardSummary] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy dữ liệu dashboard.' });
    }
};

// <<< BẮT ĐẦU SỬA LỖI >>>
// XÓA ĐOẠN CODE BỊ LẠC KHỎI ĐÂY
// const shipperId = req.user._id;
// const todayStart = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
// const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();

exports.createRemittanceRequest = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const { amount, notes, isForOldDebt = false } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Số tiền yêu cầu không hợp lệ." });
        }
        
        const existingPending = await RemittanceRequest.findOne({ shipper: shipperId, status: 'pending' });
        if (existingPending) {
            return res.status(400).json({ message: "Bạn đã có một yêu cầu đang chờ xử lý." });
        }
        
        const newRequest = new RemittanceRequest({ 
            shipper: shipperId, 
            amount, 
            shipperNotes: notes || `Yêu cầu nộp tiền lúc ${new Date().toLocaleString('vi-VN')}`, 
            isForOldDebt 
        });

        await newRequest.save();

        // <<< BẮT ĐẦU SỬA LỖI: BỌC LOGIC THÔNG BÁO TRONG TRY...CATCH RIÊNG >>>
        // Chạy tác vụ này một cách "bất đồng bộ" và không chờ đợi (fire-and-forget).
        // Điều này đảm bảo response được gửi về cho shipper ngay lập tức.
        (async () => {
            try {
                const admins = await User.find({ role: 'admin', fcmToken: { $exists: true, $ne: null } });

                if (admins.length > 0) {
                    const notificationTitle = "Yêu cầu nộp tiền mới";
                    const notificationBody = `Shipper ${req.user.name} vừa gửi yêu cầu xác nhận đã nộp ${amount.toLocaleString()}đ.`;
                    
                    const adminNotifications = admins.map(admin => ({
                        user: admin._id,
                        title: notificationTitle,
                        message: notificationBody,
                        type: 'remittance',
                        data: { remittanceRequestId: newRequest._id.toString() }
                    }));
                    await Notification.insertMany(adminNotifications);

                    for (const admin of admins) {
                        await safeNotify(admin.fcmToken, {
                            title: notificationTitle,
                            body: notificationBody,
                            data: {
                                type: 'new_remittance_request',
                                screen: 'RemittanceApproval' 
                            }
                        });
                    }
                    console.log(`[Remittance Background Task] Đã gửi thông báo đến ${admins.length} admin.`);
                }
            } catch (notificationError) {
                // Nếu có lỗi, chỉ ghi log ra server và không làm gì ảnh hưởng đến request chính.
                console.error('[Remittance Background Task] LỖI khi gửi thông báo cho Admin:', notificationError);
            }
        })();
        // <<< KẾT THÚC SỬA LỖI >>>

        // Gửi response thành công về cho shipper ngay lập tức
        res.status(201).json({ message: "Yêu cầu đã được gửi. Vui lòng chờ admin xác nhận." });

    } catch (error) {
        // Khối catch này chỉ bắt lỗi của phần logic chính (tạo request)
        console.error('[createRemittanceRequest] Lỗi logic chính:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

exports.getMonthlyFinancialReport = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ message: "Vui lòng cung cấp tháng và năm." });

        const targetMonth = parseInt(month);
        const targetYear = parseInt(year);
        
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
                totalSalaryPaid: totalSalaryPaid
            },
            dailyBreakdown: filteredBreakdown,
            hasPendingRequest: !!pendingRequest
        });
    } catch (error) {
        console.error('[getMonthlyFinancialReport] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy báo cáo.' });
    }
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
exports.getUnreadNotificationCount = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const count = await Notification.countDocuments({ user: shipperId, isRead: false });
        res.status(200).json({ count });
    } catch (error) {
        console.error("[Shipper] Lỗi đếm thông báo:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Hàm confirmRemittance không còn dùng đến, có thể xóa hoặc giữ lại để báo lỗi
exports.confirmRemittance = async (req, res) => {
    return res.status(410).json({ message: "This endpoint is deprecated." });
};
