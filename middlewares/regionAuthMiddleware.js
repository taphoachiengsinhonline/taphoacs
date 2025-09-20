// middlewares/regionAuthMiddleware.js

const verifyRegionManager = (req, res, next) => {
    if (req.user.role !== 'region_manager' && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Không có quyền truy cập.' });
    }
    // Nếu là admin thì cho qua luôn
    if (req.user.role === 'admin') {
        return next();
    }
    // Nếu là region_manager, đảm bảo họ có thông tin khu vực
    if (!req.user.region) {
        return res.status(403).json({ message: 'Tài khoản của bạn chưa được gán vào khu vực nào.' });
    }
    next();
};
module.exports = { verifyRegionManager };
