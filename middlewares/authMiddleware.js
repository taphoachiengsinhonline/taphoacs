const jwt = require('jsonwebtoken');
const User = require('../models/User');

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('[DEBUG] verifyToken - Missing or invalid auth header');
        return res.status(401).json({ message: 'Chưa đăng nhập hoặc thiếu token' });
    }

    const token = authHeader.slice(7).trim();
    
    if (!token) {
        console.log('[DEBUG] verifyToken - Empty token');
        return res.status(401).json({ message: 'Token không hợp lệ' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Lấy user từ DB, giữ nguyên instance Mongoose
        const user = await User.findById(decoded.userId).select('+password');
        if (!user) {
            console.log('[DEBUG] verifyToken - User not found:', decoded.userId);
            return res.status(401).json({ message: 'Người dùng không tồn tại' });
        }
        
        // Gán instance User vào req.user (không dùng toObject)
        req.user = user;
        console.log('[DEBUG] verifyToken - User:', user._id, 'Role:', user.role, 'Region:', user.region);
        
        next();
    } catch (err) {
        console.error('[verifyToken] Lỗi:', err);
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn' });
        }
        return res.status(401).json({ message: 'Token không hợp lệ hoặc sai' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        console.log('[DEBUG] isAdmin - User is admin:', req.user._id);
        next();
    } else {
        console.log('[DEBUG] isAdmin - User not admin:', req.user?.role);
        return res.status(403).json({ message: 'Yêu cầu quyền Quản trị viên' });
    }
};

const isSeller = (req, res, next) => {
    if (req.user && req.user.role === 'seller') {
        console.log('[DEBUG] isSeller - User is seller:', req.user._id);
        next();
    } else {
        console.log('[DEBUG] isSeller - User not seller:', req.user?.role);
        res.status(403).json({ message: 'Yêu cầu quyền Người bán' });
    }
};

const protect = verifyToken;

const restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            console.log('[DEBUG] restrictTo - User role not allowed:', req.user?.role, 'Required:', roles);
            return res.status(403).json({ message: 'Bạn không có quyền thực hiện hành động này' });
        }
        console.log('[DEBUG] restrictTo - User role allowed:', req.user.role);
        next();
    };
};

const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.userId).select('-password');
                if (user) {
                    req.user = user;
                    console.log('[DEBUG] optionalAuth - User authenticated:', user._id);
                }
            } catch (err) {
                console.log('[DEBUG] optionalAuth - Invalid token, proceeding as guest:', err.message);
            }
        }
    }
    next();
};

const isAdminOrRegionManager = (req, res, next) => {
    const { verifyRegionManager } = require('./regionAuthMiddleware');
    console.log('[DEBUG] isAdminOrRegionManager - Calling verifyRegionManager');
    verifyRegionManager(req, res, next);
};

module.exports = {
    verifyToken,
    isAdmin,
    isSeller,
    protect,
    restrictTo,
    isAdminMiddleware: isAdmin,
    verifyAdmin: isAdmin,
    optionalAuth,
    isAdminOrRegionManager,
};
