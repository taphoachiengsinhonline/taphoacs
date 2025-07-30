// backend/controllers/userController.js

const User = require('../models/User');
const Notification = require('../models/Notification');
const bcrypt = require('bcryptjs');
const Order = require('../models/Order');
const Product = require('../models/Product');
const mongoose = require('mongoose');

// Cập nhật thông tin cơ bản (name, address, phone)
exports.updateUserProfile = async (req, res) => {
  try {
    const { name, address, phone } = req.body;
    if (req.user._id.toString() !== req.params.id && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Bạn không có quyền cập nhật người dùng này' });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, address, phone },
      { new: true, runValidators: true }
    ).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User không tồn tại' });
    }
    return res.json(user);
  } catch (err) {
    console.error('[BACKEND] update-user error:', err);
    return res.status(500).json({ message: 'Lỗi server khi cập nhật user', error: err.message });
  }
};

// Đổi mật khẩu
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ các trường.' });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: 'Mật khẩu mới không khớp.' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
        }

        const user = await User.findById(req.user.id).select('+password');
        if (!user) {
            return res.status(404).json({ message: 'Người dùng không tồn tại.' });
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Mật khẩu hiện tại không chính xác.' });
        }

        user.password = newPassword;
        await user.save();

        res.status(200).json({ message: 'Đổi mật khẩu thành công!' });
        
    } catch (error) {
        console.error('[User Change Password] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server, vui lòng thử lại.' });
    }
};

// Cập nhật vị trí
exports.updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ message: 'Thiếu hoặc sai định dạng latitude/longitude' });
    }
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy user' });
    }
    user.location = {
      type: 'Point',
      coordinates: [longitude, latitude]
    };
    await user.save();
    return res.json({ message: 'Cập nhật vị trí thành công' });
  } catch (err) {
    console.error('[BACKEND] update-location error:', err);
    return res.status(500).json({ message: 'Lỗi server khi cập nhật vị trí' });
  }
};

// Lấy danh sách thông báo của user
exports.getUserNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({ user: req.user._id })
            .sort({ createdAt: -1 })
            .limit(50);
        res.status(200).json(notifications);
    } catch (error) {
        console.error("Lỗi lấy thông báo người dùng:", error);
        res.status(500).json({ message: "Lỗi server." });
    }
};

// Đếm số thông báo CHƯA ĐỌC của user
exports.getUnreadNotificationCount = async (req, res) => {
    try {
        const count = await Notification.countDocuments({ user: req.user._id, isRead: false });
        res.status(200).json({ count });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

// Đánh dấu một thông báo là đã đọc
exports.markNotificationAsRead = async (req, res) => {
    try {
        await Notification.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { isRead: true }
        );
        res.status(200).json({ message: 'Đã đánh dấu đã đọc.' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

// Xóa một thông báo
exports.deleteNotification = async (req, res) => {
    try {
        await Notification.deleteOne({ _id: req.params.id, user: req.user._id });
        res.status(200).json({ message: 'Đã xóa thông báo.' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

// Cập nhật FCM token
exports.updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ message: 'Thiếu fcmToken' });
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { fcmToken },
      { new: true }
    );
    
    res.json({
      message: 'Cập nhật FCM token thành công',
      fcmToken: updatedUser.fcmToken
    });
  } catch (error) {
    console.error('Lỗi update fcmToken:', error);
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};

// HÀM MỚI: LẤY SẢN PHẨM GỢI Ý CÁ NHÂN HÓA
exports.getPersonalizedRecommendations = async (req, res) => {
    try {
        const userId = req.user._id;
        const limit = parseInt(req.query.limit, 10) || 8;

        const recentOrders = await Order.find({ user: userId, status: 'Đã giao' })
            .sort({ 'timestamps.deliveredAt': -1 })
            .limit(5)
            .select('items.productId')
            .lean();

        if (recentOrders.length === 0) {
            return res.json([]);
        }

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
