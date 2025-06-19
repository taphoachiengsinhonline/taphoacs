// middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Chưa đăng nhập' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.userId).select('-password');
    if (!req.user) {
      return res.status(401).json({ message: 'User không tồn tại' });
    }
    next();
  } catch (err) {
    console.error('Lỗi verify token:', err);
    res.status(401).json({ message: 'Token không hợp lệ' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Bạn không có quyền admin' });
  }
  next();
};

// Alias cho isAdmin
const isAdminMiddleware = isAdmin;

// Thêm verifyAdmin để tương thích với voucherRoutes.js
const verifyAdmin = isAdmin;


const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ message: 'Không có token, vui lòng đăng nhập' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'User không tồn tại' });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error('[protect] Lỗi:', error);
    res.status(401).json({ message: 'Token không hợp lệ' });
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Bạn không có quyền truy cập' });
    }
    next();
  };
};

module.exports = {
  verifyToken,
  isAdmin,
  isAdminMiddleware,
  verifyAdmin,
  protect,
  restrictTo,
};
