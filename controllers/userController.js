const User = require('../models/User');
// <<< BƯỚC 1: THÊM CÁC IMPORT CẦN THIẾT >>>
const Order = require('../models/Order');
const Product = require('../models/Product');
const mongoose = require('mongoose');

const updateLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ message: 'Thiếu tọa độ location' });
    }

    await User.findByIdAndUpdate(userId, {
      location: {
        type: 'Point',
        coordinates: [longitude, latitude],
      },
    });

    res.json({ message: 'Cập nhật vị trí thành công' });
  } catch (error) {
    console.error('[UpdateLocation] Lỗi:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// <<< BƯỚC 2: THÊM HÀM MỚI ĐỂ LẤY SẢN PHẨM GỢI Ý CÁ NHÂN HÓA >>>
const getPersonalizedRecommendations = async (req, res) => {
    try {
        const userId = req.user._id;
        const limit = parseInt(req.query.limit, 10) || 8;

        // 1. Tìm 5 đơn hàng gần nhất của người dùng
        const recentOrders = await Order.find({ user: userId, status: 'Đã giao' })
            .sort({ 'timestamps.deliveredAt': -1 })
            .limit(5)
            .select('items.productId')
            .lean();

        if (recentOrders.length === 0) {
            return res.json([]);
        }

        // 2. Lấy ra danh sách các ID sản phẩm và danh mục họ đã mua gần đây
        const recentProductIds = [];
        recentOrders.forEach(order => {
            order.items.forEach(item => {
                recentProductIds.push(item.productId);
            });
        });

        const recentProductsDetails = await Product.find({ _id: { $in: recentProductIds } }).select('category').lean();
        const recentCategoryIds = [...new Set(recentProductsDetails.map(p => p.category.toString()))];

        if (recentCategoryIds.length === 0) {
            return res.json([]);
        }

        // 3. Tìm các sản phẩm khác trong các danh mục đó mà người dùng chưa mua
        const recommendations = await Product.find({
            category: { $in: recentCategoryIds },
            _id: { $nin: recentProductIds },
            approvalStatus: 'approved',
            totalStock: { $gt: 0 }
        })
        .limit(limit)
        .lean();

        res.json(recommendations);

    } catch (error) {
        console.error('❌ Lỗi khi lấy sản phẩm gợi ý cá nhân hóa:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
};

// <<< BƯỚC 3: CẬP NHẬT MODULE.EXPORTS >>>
module.exports = { 
    updateLocation, 
    getPersonalizedRecommendations 
};
