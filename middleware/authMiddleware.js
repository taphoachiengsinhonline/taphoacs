const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.verifyToken = async (req, res, next) => {
  let token = req.headers['x-access-token'] || req.headers['authorization'];

  // Nếu token không có, kiểm tra xem có phải dummy token không
  if (!token) {
    // Nếu không có token, trả về lỗi
    return res.status(401).json({ message: 'Không tìm thấy token' });
  }

  // Nếu token là dummy cho phát triển, bypass xác thực
  if (token === 'dummy-token-for-testing') {
    // Gán thông tin admin giả cho testing
    req.user = {
      _id: 'dummyAdminId',
      isAdmin: true
    };
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: 'Người dùng không tồn tại' });

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token không hợp lệ' });
  }
};

exports.isAdminMiddleware = (req, res, next) => {
  const user = req.user;
  if (!user || !user.isAdmin) {
    return res.status(403).json({ message: 'Chỉ admin mới có quyền thực hiện thao tác này.' });
  }
  next();
};
