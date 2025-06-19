// middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log('[verifyToken] Authorization header:', authHeader);
  
  if (!authHeader) {
    return res.status(401).json({ message: 'Chưa đăng nhập' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;
  console.log('[verifyToken] Token:', token ? 'Provided' : 'None');

  if (!token) {
    return res.status(401).json({ message: 'Không có token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('[verifyToken] Decoded:', decoded);
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      console.log('[verifyToken] User not found for ID:', decoded.userId);
      return res.status(401).json({ message: 'User không tồn tại' });
    }
    req.user = user;
    console.log('[verifyToken] User authenticated:', user._id);
    next();
  } catch (err) {
    console.error('[verifyToken] Error:', err.message);
    return res.status(401).json({ message: err.name === 'TokenExpiredError' ? 'Token hết hạn' : 'Token không hợp lệ' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    console.log('[isAdmin] Access denied for user:', req.user._id);
    return res.status(403).json({ message: 'Bạn không có quyền admin' });
  }
  next();
};

// Alias cho isAdmin
const isAdminMiddleware = isAdmin;
const verifyAdmin = isAdmin;

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log('[protect] Authorization header:', authHeader);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Không có token, vui lòng đăng nhập' });
  }

  const token = authHeader.slice(7).trim();
  console.log('[protect] Token:', token ? 'Provided' : 'None');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('[protect] Decoded:', decoded);
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      console.log('[protect] User not found for ID:', decoded.userId);
      return res.status(401).json({ message: 'User không tồn tại' });
    }
    req.user = user;
    console.log('[protect] User authenticated:', user._id);
    next();
  } catch (err) {
    console.error('[protect] Error:', err.message);
    return res.status(401).json({ message: err.name === 'TokenExpiredError' ? 'Token hết hạn' : 'Token không hợp lệ' });
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      console.log('[restrictTo] Access denied for role:', req.user.role);
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
