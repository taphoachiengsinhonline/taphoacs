const User = require('../models/User');

const verifyRegionManager = async (req, res, next) => {
    try {
        // Giả định req.user đã được gán từ verifyToken
        if (!req.user || !req.user._id) {
            console.log('[DEBUG] verifyRegionManager - No user or user._id in req.user');
            return res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ' });
        }

        // Lấy user từ DB để đảm bảo instance đầy đủ
        const user = await User.findById(req.user._id);
        if (!user) {
            console.log('[DEBUG] verifyRegionManager - User not found:', req.user._id);
            return res.status(404).json({ message: 'Không tìm thấy người dùng' });
        }

        // Cho phép cả admin và region_manager
        if (!['admin', 'region_manager'].includes(user.role)) {
            console.log('[DEBUG] verifyRegionManager - User role not allowed:', user.role);
            return res.status(403).json({ message: 'Yêu cầu quyền Quản trị viên hoặc Quản lý Vùng' });
        }

        // Cập nhật lastActive
        user.lastActive = new Date();
        await user.save();
        console.log('[DEBUG] verifyRegionManager - Saved lastActive for user', user._id, ':', user.lastActive);

        // Gán instance User vào req.user
        req.user = user;
        next();
    } catch (error) {
        console.error('[verifyRegionManager] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

module.exports = { verifyRegionManager };
