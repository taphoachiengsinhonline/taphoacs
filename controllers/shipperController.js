const mongoose = require('mongoose');
const Order = require('../models/Order');
const moment = require('moment-timezone');

exports.getOrderCounts = async (req, res) => {
  try {
    const { start, end } = this.getCurrentMonthRange();
    console.log(`[getOrderCounts] User ID: ${req.user._id}, Date range: ${start} - ${end}`);
    
    // Đảm bảo user ID là ObjectId hợp lệ
    const userId = new mongoose.Types.ObjectId(req.user._id);
    
    const counts = await Order.aggregate([
      {
        $match: {
          shipper: userId,
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$count" },
          counts: { $push: { k: "$_id", v: "$count" } }
        }
      },
      {
        $project: {
          _id: 0,
          total: 1,
          counts: { $arrayToObject: "$counts" }
        }
      }
    ]);

    console.log('[getOrderCounts] Aggregation result:', JSON.stringify(counts, null, 2));
    
    // Kết quả mặc định
    const result = {
      total: 0,
      'Chờ xác nhận': 0,
      'Đang xử lý': 0,
      'Đang giao': 0,
      'Đã giao': 0,
      'Đã hủy': 0
    };

    if (counts.length > 0) {
      result.total = counts[0].total || 0;
      
      // Cập nhật từ kết quả aggregation
      if (counts[0].counts) {
        Object.keys(counts[0].counts).forEach(status => {
          if (result.hasOwnProperty(status)) {
            result[status] = counts[0].counts[status];
          }
        });
      }
    }

    res.json(result);
  } catch (error) {
    console.error('[getOrderCounts] error:', error);
    res.status(500).json({ message: 'Lỗi server khi đếm đơn hàng', error: error.message });
  }
};

exports.getCurrentMonthRange = () => {
  const start = moment().tz('Asia/Ho_Chi_Minh').startOf('month').toDate();
  const end = moment().tz('Asia/Ho_Chi_Minh').endOf('month').toDate();
  return { start, end };
};
