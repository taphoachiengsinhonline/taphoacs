// middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.verifyToken = async (req, res, next) => {
  try {
    let token = req.headers['authorization'] || req.headers['x-access-token'];
    if (token && token.startsWith('Bearer ')) {
      token = token.slice(7);
    }
    if (!token) {
      return res.status(401).json({ message: 'Không tìm thấy token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.id;
    if (!userId) {
      return res.status(401).json({ message: 'Token không hợp lệ (thiếu ID)' });
    }

    // ✅ FIX: Lấy đầy đủ thông tin user bao gồm email và locationUpdatedAt
    const user = await User.findById(userId).select('name role email locationUpdatedAt');
    if (!user) {
      return res.status(401).json({ message: 'Người dùng không tồn tại' });
    }

    // ⚡ FIX: Gán toàn bộ thông tin user vào req.user
    req.user = user;
    req.user.isAdmin = user.role === 'admin';
    
    next();
  } catch (err) {
    console.error('[AUTH] Lỗi verifyToken:', err);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token đã hết hạn' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Token không hợp lệ' });
    }
    return res.status(401).json({ message: 'Lỗi xác thực token' });
  }
};

exports.isAdminMiddleware = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này' });
  }
  next();
};

exports.isAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Truy cập bị từ chối' });
  }
  next();
};
