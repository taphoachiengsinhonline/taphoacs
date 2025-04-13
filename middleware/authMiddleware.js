// authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User'); // hoặc đúng đường dẫn đến model User

// Middleware xác minh token và gán user vào req
exports.verifyToken = async (req, res, next) => {
  const token = req.headers['x-access-token'] || req.headers['authorization'];

  if (!token) {
    return res.status(401).json({ message: 'Không tìm thấy token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: 'Người dùng không tồn tại' });

    req.user = user; // Gán user vào request để dùng sau
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token không hợp lệ' });
  }
};

// Middleware kiểm tra quyền admin
exports.isAdminMiddleware = (req, res, next) => {
  const user = req.user;
  if (!user || !user.isAdmin) {
    return res.status(403).json({ message: 'Chỉ admin mới có quyền thực hiện thao tác này.' });
  }
  next();
};

