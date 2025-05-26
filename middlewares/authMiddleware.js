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

    // Thay đổi phần lấy thông tin user
const user = await User.findById(userId).select('name role'); // ✅ Thêm trường role
if (!user) {
  return res.status(401).json({ message: 'Người dùng không tồn tại' });
}

// Thêm dòng này để đảm bảo virtual field isAdmin hoạt động
user.isAdmin = user.role === 'admin'; // ⚡ Fix cứng virtual field
req.user = user;
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
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Truy cập bị từ chối' });
  }
  next();
};
