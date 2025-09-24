// File: backend/middlewares/regionAuthMiddleware.js
const User = require('../models/User');

const verifyRegionManager = async (req, res, next) => {
    try {
        // Giả định req.user đã được gán từ verifyToken
        if (!req.user || !req.user._id) {
            return res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ' });
        }

        // Cho phép cả admin và region_manager
        if (!['admin', 'region_manager'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Yêu cầu quyền Quản trị viên hoặc Quản lý Vùng' });
        }

        // Cập nhật lastActive
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng' });
        }

        user.lastActive = new Date();
        await user.save();
        console.log('[DEBUG] Saved lastActive for user', user._id, ':', user.lastActive);

        req.user = user; // Cập nhật req.user với instance đầy đủ
        next();
    } catch (error) {
        console.error('[verifyRegionManager] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

module.exports = { verifyRegionManager };
