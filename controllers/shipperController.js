// controllers/shipperController.js

const Order = require('../models/Order');
const User = require('../models/User');
const Notification = require('../models/Notification');
const bcrypt = require('bcrypt');
const moment = require('moment-timezone');
const mongoose = require('mongoose');

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

exports.getRevenueReport = async (req, res) => {
    try {
        const shipperId = req.user._id;
        const { startDate, endDate } = req.query;

        // Kiểm tra đầu vào
        if (!startDate || !endDate) {
            return res.status(400).json({ message: "Vui lòng cung cấp ngày bắt đầu và kết thúc." });
        }

        // Tạo điều kiện match cho aggregation pipeline
        const matchConditions = {
            shipper: new mongoose.Types.ObjectId(shipperId),
            status: 'Đã giao', // Chỉ tính các đơn đã giao thành công
            'timestamps.deliveredAt': {
                $gte: moment.tz(startDate, 'Asia/Ho_Chi_Minh').startOf('day').toDate(),
                $lte: moment.tz(endDate, 'Asia/Ho_Chi_Minh').endOf('day').toDate()
            }
        };

        const result = await Order.aggregate([
            { $match: matchConditions },
            {
                $group: {
                    _id: null, // Gom tất cả các đơn hàng phù hợp lại
                    
                    // 1. TÍNH TỔNG THU NHẬP THỰC NHẬN CỦA SHIPPER
                    // Đây là số tiền shipper thực sự bỏ túi.
                    totalIncome: { $sum: '$shipperIncome' },
                    
                    // 2. TÍNH TỔNG PHÍ SHIP GỐC ĐÃ GIAO
                    // Đây là tổng phí ship + phụ phí, không bị ảnh hưởng bởi voucher, dùng để đối soát.
                    totalShippingFeeGenerated: { $sum: { $add: ["$shippingFee", "$extraSurcharge"] } },
                    
                    // 3. ĐẾM TỔNG SỐ ĐƠN ĐÃ HOÀN THÀNH
                    completedOrders: { $sum: 1 }
                }
            }
        ]);

        // Nếu không có đơn nào trong khoảng thời gian, trả về kết quả mặc định là 0
        const stats = result[0] || {
            totalIncome: 0,
            totalShippingFeeGenerated: 0,
            completedOrders: 0
        };
        
        // Xóa trường _id không cần thiết khỏi kết quả cuối cùng
        delete stats._id;

        res.status(200).json(stats);

    } catch (error) {
        console.error('[getShipperRevenue] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy báo cáo doanh thu.' });
    }
};
