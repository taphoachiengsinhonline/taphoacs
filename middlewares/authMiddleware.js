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

    // Hỗ trợ cả kiểu cũ lẫn mới
    const userId = decoded.userId || decoded.id;
    if (!userId) {
      return res.status(401).json({ message: 'Token không hợp lệ (thiếu ID)' });
    }

    const user = await User.findById(userId).select('name isAdmin');
    if (!user) {
      return res.status(401).json({ message: 'Người dùng không tồn tại' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('[AUTH] Lỗi verifyToken:', err);
    return res.status(401).json({ message: 'Token không hợp lệ hoặc hết hạn' });
  }
};

exports.isAdminMiddleware = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này' });
  }
  next();
};
