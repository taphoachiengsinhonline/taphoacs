const Order = require('../models/Order');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Remittance = require('../models/Remittance');
const bcrypt = require('bcrypt');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const { safeNotify } = require('../utils/notificationMiddleware');
const RemittanceRequest = require('../models/RemittanceRequest');


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
            { $match: { shipper: shipperId } },
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


// ==========================================================
// === SỬA LỖI LẦN CUỐI: ĐỒNG BỘ LOGIC TÍNH TOÁN VỚI BÁO CÁO ===
// ==========================================================
exports.getDashboardSummary = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const todayString = moment().tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
        const todayStart = moment(todayString).startOf('day').toDate();

        const [deliveredOrdersToday, remittanceToday, processingOrders, notifications, pendingRequest] = await Promise.all([
            // Lấy tất cả đơn đã giao để lọc ra đơn của hôm nay, đảm bảo tính đúng
            Order.find({
                shipper: shipperId,
                status: 'Đã giao'
            }).lean(),
            Remittance.findOne({
                shipper: shipperId,
                remittanceDate: todayStart,
                status: 'completed'
            }).lean(),
            Order.countDocuments({
                shipper: shipperId,
                status: { $in: ['Đang xử lý', 'Đang giao'] }
            }),
            Notification.find({ user: shipperId }).sort('-createdAt').limit(3).lean(),
            RemittanceRequest.findOne({ shipper: shipperId, status: 'pending' }).lean()
        ]);
        
        let todayCOD = 0;
        let todayIncome = 0;
        let completedOrdersTodayCount = 0;

        // Lọc và tính toán trên server, giống hệt cách API báo cáo làm
        for (const order of deliveredOrdersToday) {
            const deliveredDay = moment(order.timestamps.deliveredAt).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
            if (deliveredDay === todayString) {
                todayCOD += order.total || 0;
                todayIncome += order.shipperIncome || 0;
                completedOrdersTodayCount++;
            }
        }
        
        const amountRemittedToday = remittanceToday ? remittanceToday.amount : 0;
        const amountToRemitToday = todayCOD - amountRemittedToday;

        res.status(200).json({
            remittance: {
                amountToRemit: amountToRemitToday > 0 ? amountToRemitToday : 0,
                completedOrders: completedOrdersTodayCount,
                totalShipperIncome: todayIncome
            },
            notifications,
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

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Số tiền yêu cầu không hợp lệ." });
        }
        
        const existingPending = await RemittanceRequest.findOne({ shipper: shipperId, status: 'pending' });
        if (existingPending) {
            return res.status(400).json({ message: "Bạn đã có một yêu cầu đang chờ xử lý. Vui lòng đợi Admin xác nhận trước khi tạo yêu cầu mới." });
        }

        const newRequest = new RemittanceRequest({
            shipper: shipperId,
            amount: amount,
            shipperNotes: notes || `Yêu cầu nộp tiền lúc ${new Date().toLocaleString('vi-VN')}`,
            isForOldDebt: isForOldDebt
        });

        await newRequest.save();
        
        res.status(201).json({ message: "Yêu cầu đã được gửi. Vui lòng chờ admin xác nhận." });
    } catch (error) {
        console.error('[createRemittanceRequest] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};


exports.getMonthlyFinancialReport = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({ message: "Vui lòng cung cấp tháng và năm." });
        }

        const targetMonth = parseInt(month) - 1;
        const targetYear = parseInt(year);

        const [deliveredOrders, remittances, pendingRequest] = await Promise.all([
            Order.find({
                shipper: shipperId, 
                status: 'Đã giao'
            }).lean(),
            Remittance.find({
                shipper: shipperId,
                status: 'completed'
            }).lean(),
            RemittanceRequest.findOne({ shipper: req.user._id, status: 'pending' }).lean()
        ]);
        
        const dailyData = {};
        const remittedMap = new Map();
        remittances.forEach(r => { remittedMap.set(moment(r.remittanceDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD'), r.amount || 0); });

        deliveredOrders.forEach(order => {
            const day = moment(order.timestamps.deliveredAt).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
            if (!dailyData[day]) {
                dailyData[day] = { codCollected: 0, income: 0, orderCount: 0 };
            }
            dailyData[day].codCollected += (order.total || 0);
            dailyData[day].income += (order.shipperIncome || 0);
            dailyData[day].orderCount += 1;
        });

        Object.keys(dailyData).forEach(day => {
            dailyData[day].amountRemitted = remittedMap.get(day) || 0;
        });
        
        let totalIncomeThisMonth = 0;
        let accumulatedDebt = 0;
        const todayString = moment().tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
        
        Object.entries(dailyData).forEach(([day, data]) => {
            const dayMoment = moment(day);
            if (dayMoment.month() === targetMonth && dayMoment.year() === targetYear) {
                totalIncomeThisMonth += data.income;
            }
            if (day < todayString) {
                accumulatedDebt += (data.codCollected - data.amountRemitted);
            }
        });
        
        const todayData = dailyData[todayString] || { codCollected: 0, amountRemitted: 0 };
        const todayDebt = todayData.codCollected - todayData.amountRemitted;

        const monthlyBreakdown = Object.entries(dailyData)
            .filter(([day]) => {
                const dayMoment = moment(day);
                return dayMoment.month() === targetMonth && dayMoment.year() === targetYear;
            })
            .map(([day, data]) => ({ day, ...data }))
            .reverse();
        
        res.status(200).json({
            overview: {
                totalDebt: accumulatedDebt > 0 ? accumulatedDebt : 0,
                todayDebt: todayDebt > 0 ? todayDebt : 0,
                totalIncome: totalIncomeThisMonth,
            },
            dailyBreakdown: monthlyBreakdown,
            hasPendingRequest: !!pendingRequest
        });
    } catch (error) {
        console.error('[getMonthlyFinancialReport] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy báo cáo.' });
    }
};


exports.confirmRemittance = async (req, res) => {
    // This function is deprecated
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const shipperId = req.user._id;
        const { amount, transactionDate, isForOldDebt } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Số tiền nộp không hợp lệ." });
        }

        if (isForOldDebt) {
            let amountToApply = amount;
            
            const orders = await Order.find({ shipper: shipperId, status: 'Đã giao' }).sort({ 'timestamps.deliveredAt': 1 }).session(session);
            const remittances = await Remittance.find({ shipper: shipperId }).session(session);

            const remittedMap = new Map();
            remittances.forEach(r => { remittedMap.set(moment(r.remittanceDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD'), r.amount || 0); });

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
                        { shipper: shipperId, remittanceDate: moment.tz(day, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh').startOf('day').toDate() },
                        { $inc: { amount: payment }, $push: { transactions: { amount: payment, confirmedAt: new Date(), notes: "Thanh toán nợ cũ" } } },
                        { upsert: true, new: true, session: session }
                    );
                    amountToApply -= payment;
                }
            }
        } else {
            if (!transactionDate) {
                 return res.status(400).json({ message: "Thiếu ngày giao dịch." });
            }
            const date = moment(transactionDate).tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
            await Remittance.findOneAndUpdate(
                { shipper: shipperId, remittanceDate: date },
                { 
                    $inc: { amount: amount },
                    $push: { transactions: { amount: amount, confirmedAt: new Date() } }
                },
                { upsert: true, new: true, session: session }
            );
        }
        
        await session.commitTransaction();
        res.status(200).json({ message: "Xác nhận nộp tiền thành công!" });

    } catch (error) {
        await session.abortTransaction();
        console.error('[confirmRemittance] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi xác nhận nộp tiền.' });
    } finally {
        session.endSession();
    }
};

exports.sendCODRemittanceReminder = async () => {
    console.log("CRON JOB: Bắt đầu gửi thông báo nhắc nộp tiền COD...");
    try {
        const todayStart = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();

        const activeShippers = await Order.distinct('shipper', {
            status: 'Đã giao',
            'timestamps.deliveredAt': { $gte: todayStart, $lte: todayEnd }
        });
        
        if (activeShippers.length === 0) {
            console.log("CRON JOB: Không có shipper nào hoạt động hôm nay.");
            return;
        }

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
                
                await safeNotify(shipper.fcmToken, {
                    title: '📢 Nhắc nhở nộp tiền COD',
                    body: message,
                    data: { type: 'remittance_reminder' }
                });

                await Notification.create({
                    user: shipperId,
                    title: 'Nhắc nhở nộp tiền COD',
                    message: message,
                    type: 'finance'
                });
                console.log(`CRON JOB: Đã gửi thông báo cho shipper ${shipperId} số tiền ${amountToRemit}`);
            }
        }
        console.log("CRON JOB: Hoàn thành gửi thông báo.");
    } catch (error) {
        console.error("CRON JOB ERROR: Lỗi khi gửi thông báo nhắc nợ:", error);
    }
};
