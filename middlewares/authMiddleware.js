// middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ message: 'Chưa đăng nhập' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;
  
  if (!token) {
    return res.status(401).json({ message: 'Không có token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password commissionRate');
    if (!user) {
      return res.status(401).json({ message: 'User không tồn tại' });
    }
    req.user = user;
     next();
  } catch (err) {
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

const isSeller = (req, res, next) => {
    // Hàm này chạy SAU KHI verifyToken đã chạy,
    // nên chúng ta có thể tin tưởng rằng req.user đã tồn tại.
    if (req.user && req.user.role === 'seller') {
        next(); // Nếu là seller, cho qua
    } else {
        res.status(403).json({ message: 'Yêu cầu quyền người bán (Seller)' });
    }
};

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Không có token, vui lòng đăng nhập' });
  }

  const token = authHeader.slice(7).trim();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
       return res.status(401).json({ message: 'User không tồn tại' });
    }
    req.user = user;
    next();
  } catch (err) {
   return res.status(401).json({ message: err.name === 'TokenExpiredError' ? 'Token hết hạn' : 'Token không hợp lệ' });
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
  isSeller,
};
