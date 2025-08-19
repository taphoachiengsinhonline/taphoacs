// File: backend/middlewares/authMiddleware.js
// PHIÊN BẢN HOÀN CHỈNH

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware chính để xác thực token.
 * Sẽ được sử dụng cho hầu hết các API yêu cầu đăng nhập.
 * Nó giải mã token, tìm người dùng và gắn object `user` vào `req`.
 * Đã được sửa để lấy thêm `commissionRate` một cách an toàn.
 */
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Chưa đăng nhập hoặc thiếu token' });
  }

  const token = authHeader.slice(7).trim();
  
  if (!token) {
    return res.status(401).json({ message: 'Token không hợp lệ' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // SỬA LỖI Ở ĐÂY: Dùng cú pháp an toàn để lấy tất cả các trường,
    // trừ password và cộng thêm commissionRate.
    const user = await User.findById(decoded.userId).select('-password +commissionRate');
    
    if (!user) {
      return res.status(401).json({ message: 'Người dùng không tồn tại' });
    }
    
    // Gắn object user đầy đủ (trừ password) vào request để các hàm sau sử dụng
    req.user = user;
    next();
  } catch (err) {
      // Xử lý các lỗi của JWT
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn' });
      }
      return res.status(401).json({ message: 'Token không hợp lệ hoặc sai' });
  }
};

/**
 * Middleware để kiểm tra vai trò Admin.
 * Phải được sử dụng SAU `verifyToken`.
 */
const isAdmin = (req, res, next) => {
  // req.user đã được gắn bởi verifyToken
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    return res.status(403).json({ message: 'Yêu cầu quyền Quản trị viên' });
  }
};

/**
 * Middleware để kiểm tra vai trò Seller.
 * Phải được sử dụng SAU `verifyToken`.
 */
const isSeller = (req, res, next) => {
    if (req.user && req.user.role === 'seller') {
        next();
    } else {
        res.status(403).json({ message: 'Yêu cầu quyền Người bán' });
    }
};

/**
 * Middleware `protect` là một tên gọi khác cho `verifyToken`.
 * Giữ lại để tương thích nếu có route nào đang dùng nó.
 * Đã được sửa lại để nhất quán với `verifyToken`.
 */
const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Không có token, vui lòng đăng nhập' });
  }

  const token = authHeader.slice(7).trim();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findById(decoded.userId).select('-password +commissionRate');

    if (!user) {
       return res.status(401).json({ message: 'Người dùng không tồn tại' });
    }
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn' });
    }
    return res.status(401).json({ message: 'Token không hợp lệ hoặc sai' });
  }
};

/**
 * Middleware factory để giới hạn quyền truy cập cho một hoặc nhiều vai trò.
 * Ví dụ: restrictTo('admin', 'seller')
 * Phải được sử dụng SAU `verifyToken`.
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    // req.user đã được gắn bởi verifyToken
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Bạn không có quyền thực hiện hành động này' });
    }
    next();
  };
};


module.exports = {
  verifyToken,
  isAdmin,
  isSeller,
  protect,
  restrictTo,
  // Giữ lại các alias để tương thích ngược nếu có
  isAdminMiddleware: isAdmin,
  verifyAdmin: isAdmin,
};
