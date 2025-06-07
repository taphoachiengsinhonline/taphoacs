const Order = require('../models/Order');
// Thêm controller trong controllers/shipperController.js
const getCurrentMonthRange = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: startOfMonth.toISOString(),
    end:   endOfMonth.toISOString()
  };
};

exports.getOrderCounts = async (req, res) => {
  try {
    const { start, end } = getCurrentMonthRange();
    const counts = await Order.aggregate([
      { $match: {
          shipper: req.user._id,
          createdAt: { $gte: new Date(start), $lte: new Date(end) }
      }},
      { $group: { _id: "$status", count: { $sum: 1 } }},
      { $group: {
          _id: null,
          total: { $sum: "$count" },
          counts: { $push: { status: "$_id", count: "$count" } }
      }}
    ]);
    const result = {
      total: counts[0]?.total || 0,
      'Chờ xác nhận': 0,
      'Đang xử lý': 0,
      'Đang giao': 0,
      'Đã giao': 0,
      'Đã huỷ': 0
    };
    if (counts[0]?.counts) {
      counts[0].counts.forEach(item => {
        result[item.status] = item.count;
      });
    }
    res.json(result);
  } catch (error) {
    console.error('[getOrderCounts] error:', error);
    res.status(500).json({ message: 'Lỗi server khi đếm đơn hàng' });
  }
};

