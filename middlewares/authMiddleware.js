const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware xác thực token
exports.verifyToken = async (req, res, next) => {
  try {
    // Lấy token từ headers
    let token = req.headers['x-access-token'] || req.headers['authorization'];

    // Nếu có dạng "Bearer <token>", tách ra
    if (token && token.startsWith('Bearer ')) {
      token = token.slice(7, token.length).trim();
    }

    // Nếu không có token
    if (!token) {
      return res.status(401).json({ message: 'Không tìm thấy token' });
    }

    // Dummy token (cho testing)
    if (token === 'dummy-token-for-testing') {
      req.user = {
        _id: 'dummyAdminId',
        isAdmin: true
      };
      return next();
    }

    // Xác thực token bằng JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Kiểm tra xem decoded có chứa id không
    if (!decoded?.id) {
      return res.status(401).json({ message: 'Token không hợp lệ (thiếu ID)' });
    }

    // Tìm người dùng từ DB
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'Người dùng không tồn tại' });
    }

    // Gắn user vào req để các middleware/router phía sau dùng
    req.user = user;
    next();

  } catch (error) {
    console.error('Xác thực token thất bại:', error.message);
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
