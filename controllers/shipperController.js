// controllers/shipperController.js

const Order = require('../models/Order');
const User = require('../models/User');
const moment = require('moment-timezone'); // Cần thư viện này

// ==============================================================================
// ===                  HÀM ĐẾM ĐƠN HÀNG - ĐÃ SỬA LẠI                         ===
// ==============================================================================
exports.getOrderCounts = async (req, res) => {
  try {
    const shipperId = req.user._id;
    const counts = await Order.aggregate([
      { $match: { shipper: shipperId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    
    const result = { total: 0, 'Đang xử lý': 0, 'Đang giao': 0, 'Đã giao': 0, 'Đã huỷ': 0 };
    counts.forEach(item => {
      if (result.hasOwnProperty(item._id)) {
        result[item._id] = item.count;
      }
    });
    result.total = counts.reduce((sum, item) => sum + item.count, 0);

    res.json(result);
  } catch (error) {
    console.error('[getOrderCounts] error:', error);
    res.status(500).json({ message: 'Lỗi server khi đếm đơn hàng' });
  }
};


// ==============================================================================
// ===                  HÀM THỐNG KÊ DOANH THU - ĐÃ SỬA LẠI                   ===
// ==============================================================================
exports.getShipperStats = async (req, res) => {
  try {
    const shipperId = req.user._id;

    // Lấy tất cả các đơn đã gán cho shipper này
    const allAssignedOrders = await Order.find({ shipper: shipperId });
    
    const totalOrders = allAssignedOrders.length;
    
    // Lọc ra các đơn đã giao để tính toán
    const completedOrders = allAssignedOrders.filter(order => order.status === 'Đã giao');
    const completedOrdersCount = completedOrders.length;
    
    // Tính tổng doanh thu (thu hộ) và tổng lợi nhuận thực nhận
    const { totalRevenue, totalIncome } = completedOrders.reduce((acc, order) => {
        acc.totalRevenue += order.total || 0;
        acc.totalIncome += order.shipperIncome || 0;
        return acc;
    }, { totalRevenue: 0, totalIncome: 0 });

    res.json({
      totalOrders: totalOrders,
      completedOrders: completedOrdersCount,
      revenue: totalIncome, // Trả về lợi nhuận thực nhận cho thẻ Doanh thu
    });

  } catch (error) {
    console.error('Lỗi khi lấy thống kê shipper:', error);
    res.status(500).json({ message: 'Lỗi server khi lấy thống kê' });
  }
};


// ==============================================================================
// ===      HÀM NHẬN ĐƠN - Đảm bảo trả về dữ liệu đúng chuẩn                  ===
// ==============================================================================
exports.acceptOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Đơn hàng không tồn tại' });
    if (order.status !== 'Chờ xác nhận') return res.status(400).json({ message: 'Đơn không khả dụng' });

    const shipper = await User.findById(req.user._id);
    if (!shipper || shipper.role !== 'shipper') return res.status(403).json({ message: 'Tài khoản không phải là shipper.' });

    order.status = 'Đang xử lý';
    order.shipper = shipper._id;
    order.timestamps.acceptedAt = new Date();

    const shareRate = (shipper.shipperProfile.shippingFeeShareRate || 0) / 100;
    const totalShippingFee = (order.shippingFee || 0) + (order.extraSurcharge || 0);
    const totalCommission = order.items.reduce((sum, item) => sum + (item.commissionAmount || 0), 0);
    const profitShareRate = (shipper.shipperProfile.profitShareRate || 0) / 100;
    order.shipperIncome = (totalShippingFee * shareRate) + (totalCommission * profitShareRate);
    
    order.financialDetails = {
        shippingFee: order.shippingFee,
        extraSurcharge: order.extraSurcharge,
        shippingFeeShareRate: shipper.shipperProfile.shippingFeeShareRate,
        profitShareRate: shipper.shipperProfile.profitShareRate
    };
    
    const updated = await order.save();
    
    // Gửi thông báo cho khách hàng
    const customer = await User.findById(order.user);
    if (customer?.fcmToken) { /* ... Gửi thông báo ... */ }
    
    // Trả về order đã được cập nhật đầy đủ
    res.json({ 
      message: 'Nhận đơn thành công',
      order: { ...updated.toObject(), timestamps: updated.timestamps }
    });
  } catch (error) {
    console.error('Lỗi nhận đơn:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
