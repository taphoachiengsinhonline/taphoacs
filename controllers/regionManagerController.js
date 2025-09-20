// File: backend/controllers/regionManagerController.js

const Order = require('../models/Order');
const moment = require('moment-timezone');

/**
 * Lấy tổng quan tài chính cho Quản lý Vùng đang đăng nhập.
 * Tính toán dựa trên các đơn hàng đã giao và lợi nhuận đã được chia (recipientProfit).
 */
exports.getFinancialOverview = async (req, res) => {
    try {
        const managerId = req.user._id;
        const { period } = req.query; // Nhận tham số 'period' từ query (vd: 'today', 'this_month')

        // Mặc định là 'all_time' nếu không có period
        let startDate, endDate;
        const now = moment().tz('Asia/Ho_Chi_Minh');

        if (period === 'today') {
            startDate = now.clone().startOf('day').toDate();
            endDate = now.clone().endOf('day').toDate();
        } else if (period === 'this_month') {
            startDate = now.clone().startOf('month').toDate();
            endDate = now.clone().endOf('month').toDate();
        }
        // Nếu không có period, không cần startDate, endDate

        // Xây dựng câu lệnh match cho MongoDB
        const matchStage = {
            status: 'Đã giao',
            profitRecipient: managerId
        };

        // Nếu có khoảng thời gian, thêm vào câu lệnh match
        if (startDate && endDate) {
            matchStage['timestamps.deliveredAt'] = {
                $gte: startDate,
                $lte: endDate
            };
        }
        
        // Dùng aggregate để tính toán
        const result = await Order.aggregate([
            {
                $match: matchStage
            },
            {
                $group: {
                    _id: null, // Nhóm tất cả lại thành 1
                    totalProfit: { $sum: '$recipientProfit' },
                    totalOrders: { $sum: 1 },
                    totalRevenue: { $sum: '$total' } // Tổng tiền thu từ khách của các đơn này
                }
            }
        ]);

        const overview = result[0] || { totalProfit: 0, totalOrders: 0, totalRevenue: 0 };
        
        res.status(200).json({
            period: period || 'all_time',
            totalProfit: overview.totalProfit,
            totalManagedOrders: overview.totalOrders,
            totalRevenueFromManagedOrders: overview.totalRevenue
        });

    } catch (error) {
        console.error('[RegionManager FinancialOverview] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy báo cáo tài chính.' });
    }
};

// Trong tương lai, bạn có thể thêm các hàm khác ở đây
// exports.getManagedSellers = async (req, res) => { ... }
