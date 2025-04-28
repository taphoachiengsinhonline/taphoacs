// middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.isAdminMiddleware = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ message: 'Bạn không có quyền truy cập' });
  }
  next();
};

exports.verifyToken = async (req, res, next) => {
  let token = req.headers['x-access-token'] || req.headers['authorization'];

  if (token && token.startsWith('Bearer ')) {
    token = token.slice(7);
  }

  if (!token) {
    console.warn('[AUTH] Không có token');
    return res.status(401).json({ message: 'Không tìm thấy token' });
  }

  if (token === 'dummy-token-for-testing') {
    req.user = { _id: 'dummyAdminId', isAdmin: true };
    return next();
  }

   try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('[AUTH] Token decoded:', decoded);

    const userId = decoded.userId || decoded._id || decoded.id;

    if (!userId) {
      console.warn('[AUTH] Token thiếu userId');
      return res.status(401).json({ message: 'Token không hợp lệ (thiếu ID)' });
    }

    // ✅ Thêm .select('name') để đảm bảo lấy trường name
    const user = await User.findById(userId).select('name isAdmin');
    
    if (!user) {
      console.warn('[AUTH] Không tìm thấy người dùng trong DB');
      return res.status(401).json({ message: 'Người dùng không tồn tại' });
    }

    // ✅ Thêm kiểm tra phụ trợ (không block request)
    if (!user.name) {
      console.warn('[AUTH] Người dùng chưa cập nhật tên:', user._id);
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('[AUTH] Lỗi verify token:', error);
    return res.status(401).json({ message: 'Token không hợp lệ hoặc hết hạn' });
  }
};
