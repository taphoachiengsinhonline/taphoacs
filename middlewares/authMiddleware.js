const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.verifyToken = async (req, res, next) => {
  let token = req.headers['x-access-token'] || req.headers['authorization'];

  // Nếu có tiền tố Bearer
  if (token && token.startsWith('Bearer ')) {
    token = token.slice(7, token.length);
  }

  if (!token) {
    return res.status(401).json({ message: 'Không tìm thấy token' });
  }

  // Dummy token (nếu có xài trong dev)
  if (token === 'dummy-token-for-testing') {
    req.user = { _id: 'dummyAdminId', isAdmin: true };
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.userId) {
      return res.status(401).json({ message: 'Token không hợp lệ (thiếu ID)' });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ message: 'Người dùng không tồn tại' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('verifyToken error:', error);
    return res.status(401).json({ message: 'Token không hợp lệ' });
  }
};
