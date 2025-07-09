// controllers/shipperController.js

const Order = require('../models/Order');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Remittance = require('../models/Remittance');
const bcrypt = require('bcrypt');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const { safeNotify } = require('../utils/notificationMiddleware'); // <<< THÊM
const RemittanceRequest = require('../models/RemittanceRequest'); // Thêm import mới


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
            sort: { 'timestamps.createdAt': -1 } // Sắp xếp theo ngày tạo đơn
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

exports.getDashboardSummary = async (req, res) => {
    try {
        const shipperId = req.user._id;
        
        // <<< SỬA: TỰ ĐỘNG LẤY NGÀY HÔM NAY, KHÔNG CẦN FRONTEND GỬI LÊN >>>
        const todayStart = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();

        const [todayDeliveredOrders, todayRemittance, processingOrders, notifications] = await Promise.all([
            Order.find({
                shipper: shipperId,
                status: 'Đã giao',
                'timestamps.deliveredAt': { $gte: todayStart, $lte: todayEnd }
            }),
            Remittance.findOne({
                shipper: shipperId,
                remittanceDate: todayStart
            }),
            Order.countDocuments({
                shipper: shipperId,
                status: { $in: ['Đang xử lý', 'Đang giao'] }
            }),
            Notification.find({ user: shipperId }).sort('-createdAt').limit(3),
            RemittanceRequest.findOne({ shipper: shipperId, status: 'pending' }) 
        ]);

        const todayCOD = todayDeliveredOrders.reduce((sum, order) => sum + (order.total || 0), 0);
        const todayIncome = todayDeliveredOrders.reduce((sum, order) => sum + (order.shipperIncome || 0), 0);
        const amountRemittedToday = todayRemittance ? todayRemittance.amount : 0;
        const amountToRemitToday = todayCOD - amountRemittedToday;

        res.status(200).json({
            remittance: {
                amountToRemit: amountToRemitToday > 0 ? amountToRemitToday : 0,
                completedOrders: todayDeliveredOrders.length,
                totalShipperIncome: todayIncome
            },
            notifications,
            processingOrderCount: processingOrders,
            hasPendingRequest: !!pendingRequest // <<< THÊM TRƯỜNG NÀY (!!) để chuyển object thành boolean
        });

    } catch (error) {
        console.error('[getDashboardSummary] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy dữ liệu dashboard.' });
    }
};


exports.createRemittanceRequest = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const shipperId = req.user._id;
        const { amount, notes, isForOldDebt = false } = req.body; // Thêm cờ isForOldDebt

        if (!amount || amount <= 0) {
            throw new Error("Số tiền yêu cầu không hợp lệ.");
        }

// Kiểm tra xem có yêu cầu nào của shipper này đang 'pending' hay không.
        const existingPending = await RemittanceRequest.findOne({ shipper: shipperId, status: 'pending' });
        if (existingPending) {
            // Trả về thông báo lỗi chung, không cần phân biệt
            return res.status(400).json({ message: "Bạn đã có một yêu cầu đang chờ xử lý. Vui lòng đợi Admin xác nhận trước khi tạo yêu cầu mới." });
        }

        const newRequest = new RemittanceRequest({
            shipper: shipperId,
            amount: amount,
            shipperNotes: notes || `Yêu cầu nộp tiền lúc ${new Date().toLocaleString('vi-VN')}`,
            isForOldDebt: isForOldDebt
        });

        await newRequest.save();
        
        // (Tùy chọn) Gửi thông báo cho Admin ở đây...
        
        await session.commitTransaction();
        res.status(201).json({ message: "Yêu cầu đã được gửi. Vui lòng chờ admin xác nhận." });
    } catch (error) {
        await session.abortTransaction();
        console.error('[createRemittanceRequest] Lỗi:', error);
        res.status(500).json({ message: error.message || 'Lỗi server.' });
    } finally {
        session.endSession();
    }
};

exports.getMonthlyFinancialReport = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({ message: "Vui lòng cung cấp tháng và năm." });
        }

        const targetMonth = parseInt(month) - 1; // JavaScript month is 0-11
        const targetYear = parseInt(year);

        // Tạo ngày đầu tiên và cuối cùng của tháng trong múi giờ UTC để query cho đúng
        const startDate = new Date(Date.UTC(targetYear, targetMonth, 1));
        const endDate = new Date(Date.UTC(targetYear, targetMonth + 1, 1));
        endDate.setUTCMilliseconds(endDate.getUTCMilliseconds() - 1);
        
        // Lấy tất cả dữ liệu cần thiết trong một lần gọi để tối ưu
        const [deliveredOrders, remittances, pendingRequest] = await Promise.all([
            Order.find({
                shipper: shipperId, 
                status: 'Đã giao',
                'timestamps.deliveredAt': { $gte: startDate, $lte: endDate }
            }).lean(),
            Remittance.find({
                shipper: shipperId,
                remittanceDate: { $gte: startDate, $lte: endDate }
            }).lean(),
            RemittanceRequest.findOne({ shipper: req.user._id, status: 'pending' }) // <<< THÊM DÒNG NÀY
        ]);
        
        // Tạo một object rỗng để chứa dữ liệu của mỗi ngày trong tháng
        const dailyData = {};
        const daysInMonth = moment(startDate).utc().daysInMonth();
        for (let i = 1; i <= daysInMonth; i++) {
            const day = moment(startDate).utc().date(i).format('YYYY-MM-DD');
            dailyData[day] = { 
                codCollected: 0, 
                amountRemitted: 0, 
                income: 0, 
                orderCount: 0 
            };
        }

        // Điền dữ liệu từ các đơn hàng đã giao vào các ngày tương ứng
        deliveredOrders.forEach(order => {
            const day = moment(order.timestamps.deliveredAt).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
            if (dailyData[day]) {
                dailyData[day].codCollected += (order.total || 0);
                dailyData[day].income += (order.shipperIncome || 0);
                dailyData[day].orderCount += 1;
            }
        });

        // Điền dữ liệu từ các lần đã nộp tiền vào các ngày tương ứng
        remittances.forEach(remit => {
            const day = moment(remit.remittanceDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
            if (dailyData[day]) {
                dailyData[day].amountRemitted = remit.amount || 0;
            }
        });
        
        // Bắt đầu tính toán các con số tổng hợp
        let totalCODCollected = 0;
        let totalIncome = 0;
        let totalRemitted = 0;
        let totalCompletedOrders = 0;
        let accumulatedDebt = 0; // Công nợ tồn đọng (không tính hôm nay)

        const todayString = moment().tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
        
        // Lặp qua dữ liệu đã xử lý để tính tổng
        Object.entries(dailyData).forEach(([day, data]) => {
            totalCODCollected += data.codCollected;
            totalIncome += data.income;
            totalRemitted += data.amountRemitted;
            totalCompletedOrders += data.orderCount;
            
            // Chỉ cộng dồn công nợ của những ngày TRƯỚC HÔM NAY
            if (day < todayString) {
                accumulatedDebt += (data.codCollected - data.amountRemitted);
            }
        });
        
        // Tính riêng công nợ của ngày hôm nay để hiển thị tham khảo
        const todayData = dailyData[todayString] || { codCollected: 0, amountRemitted: 0 };
        const todayDebt = todayData.codCollected - todayData.amountRemitted;
        
        // Trả về response cuối cùng
        res.status(200).json({
            overview: {
                totalDebt: accumulatedDebt > 0 ? accumulatedDebt : 0, // Chỉ là nợ của các ngày cũ
                todayDebt: todayDebt > 0 ? todayDebt : 0, // Nợ phát sinh trong hôm nay
                totalIncome,
                totalCODCollected,
                totalRemitted,
                totalCompletedOrders
            },
            dailyBreakdown: Object.entries(dailyData).map(([day, data]) => ({ 
                day, 
                ...data 
            })).reverse(), // Đảo ngược để ngày mới nhất lên đầu
            hasPendingRequest: !!pendingRequest // <<< THÊM TRƯỜNG NÀY
        });
    } catch (error) {
        console.error('[getMonthlyFinancialReport] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy báo cáo.' });
    }
};


// ======================================================================
// ===          API MỚI: SHIPPER XÁC NHẬN ĐÃ NỘP TIỀN                ===
// ======================================================================
exports.confirmRemittance = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const shipperId = req.user._id;
        // isForOldDebt: một cờ để biết đây là nộp nợ cũ hay nộp cho ngày cụ thể
        const { amount, transactionDate, isForOldDebt } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Số tiền nộp không hợp lệ." });
        }

        if (isForOldDebt) {
            // === LOGIC NỘP CÔNG NỢ CŨ ===
            let amountToApply = amount;
            
            // Tìm tất cả các ngày có công nợ (COD > đã nộp)
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
                if (day >= todayString) continue; // Bỏ qua ngày hôm nay

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
            // === LOGIC NỘP CHO NGÀY CỤ THỂ (HÔM NAY) ===
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

// ======================================================================
// ===       HÀM MỚI: Gửi thông báo nhắc nợ COD (dùng cho Cron Job)    ===
// ======================================================================
exports.sendCODRemittanceReminder = async () => {
    console.log("CRON JOB: Bắt đầu gửi thông báo nhắc nộp tiền COD...");
    try {
        const todayStart = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();

        // Lấy tất cả shipper có hoạt động giao hàng hôm nay
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

            // Tính toán số tiền cần nộp của shipper này
            const orders = await Order.find({ shipper: shipperId, status: 'Đã giao', 'timestamps.deliveredAt': { $gte: todayStart, $lte: todayEnd } });
            const totalCOD = orders.reduce((sum, order) => sum + order.total, 0);

            const remittance = await Remittance.findOne({ shipper: shipperId, remittanceDate: { $gte: todayStart, $lte: todayEnd } });
            const amountRemitted = remittance ? remittance.amount : 0;
            const amountToRemit = totalCOD - amountRemitted;

            if (amountToRemit > 0) {
                const message = `Bạn cần nộp ${amountToRemit.toLocaleString()}đ tiền thu hộ (COD) cho ngày hôm nay. Vui lòng hoàn thành trước khi bắt đầu ca làm việc tiếp theo.`;
                
                // Gửi thông báo đẩy
                await safeNotify(shipper.fcmToken, {
                    title: '📢 Nhắc nhở nộp tiền COD',
                    body: message,
                    data: { type: 'remittance_reminder' }
                });

                // Lưu vào DB Notification
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
