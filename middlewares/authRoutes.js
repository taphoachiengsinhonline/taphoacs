const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const voucherController = require('../controllers/voucherController');

// Hàm tạo Access + Refresh token
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '30m' }
  );

  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};

// Đăng ký tài khoản
router.post('/register', async (req, res) => {
  console.log('Register body:', req.body);
  try {
    const { name, email, password, address, phone, location, role, fcmToken, shipperProfile } = req.body;

    // Kiểm tra thông tin bắt buộc
    if (!name || !email || !password || !address || !phone) {
      return res.status(400).json({
        status: 'error',
        message: 'Vui lòng điền đầy đủ: họ và tên, email, mật khẩu, địa chỉ, số điện thoại'
      });
    }

    // Kiểm tra email đã tồn tại
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ status: 'error', message: 'Email đã tồn tại' });
    }

    // Kiểm tra role hợp lệ
    const validRoles = ['customer', 'admin', 'shipper'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ status: 'error', message: 'Role không hợp lệ' });
    }

    // Chuẩn bị dữ liệu user
    const userData = {
      name,
      email: email.toLowerCase().trim(),
      password,
      address,
      phone,
      role: role || 'customer',
      location: location || { type: 'Point', coordinates: [0, 0] }
    };

    // Thêm fcmToken nếu có
    if (fcmToken) {
      userData.fcmToken = fcmToken;
    }

    // Thêm thông tin shipper nếu role là shipper
    if (role === 'shipper') {
      if (!shipperProfile?.vehicleType || !shipperProfile?.licensePlate) {
        return res.status(400).json({ status: 'error', message: 'Thiếu thông tin phương tiện cho shipper' });
      }
      userData.shipperProfile = shipperProfile;
    }

    // Tạo user mới
    const user = new User(userData);
    await user.save();

    // Cấp voucher cho khách mới nếu role là customer
    let voucherMessage = null;
    if (user.role === 'customer') {
      const voucher = await voucherController.grantNewUserVoucher(user._id);
      if (voucher) {
        voucherMessage = `Chúc mừng! Bạn nhận được voucher ${voucher.code} giảm ${voucher.discount.toLocaleString()}đ phí ship.`;
      }
    }

    // Tạo token
    const { accessToken, refreshToken } = generateTokens(user._id);

    res.status(201).json({
      status: 'success',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          address: user.address,
          phone: user.phone,
          role: user.role,
          isAdmin: user.role === 'admin'
        },
        token: accessToken,
        refreshToken,
        voucherMessage
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ status: 'error', message: err.message || 'Lỗi server' });
  }
});

// Đăng nhập
router.post('/login', async (req, res) => {
  try {
    const { email, password, client_type } = req.body;
    console.log('[DEBUG] Login request:', { email, client_type });

    // Kiểm tra email và password
    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Vui lòng nhập email và mật khẩu' });
    }

    // Tìm user
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password +role +phone +address');
    console.log('[DEBUG] User found:', user ? user.email : 'Không tồn tại');

    if (!user) {
      return res.status(401).json({ status: 'error', message: 'Email hoặc mật khẩu không đúng' });
    }

    // So sánh mật khẩu
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('[DEBUG] Password match:', isMatch);

    if (!isMatch) {
      return res.status(401).json({ status: 'error', message: 'Email hoặc mật khẩu không đúng' });
    }

    // Kiểm tra client_type và role
    if (client_type === 'shipper' && user.role !== 'shipper') {
      console.log('[DEBUG] Role không hợp lệ:', user.role);
      return res.status(403).json({
        status: 'error',
        message: 'Tài khoản không có quyền shipper'
      });
    }

    // Tạo token và response
    const { accessToken, refreshToken } = generateTokens(user._id);
    res.status(200).json({
      status: 'success',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          address: user.address,
          role: user.role,
          isAdmin: user.role === 'admin'
        },
        token: accessToken,
        refreshToken
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ status: 'error', message: 'Lỗi server' });
  }
});

// Làm mới token
router.post('/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ status: 'error', message: 'Thiếu refresh token' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId);

    return res.status(200).json({
      status: 'success',
      data: {
        token: accessToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ status: 'error', message: 'Refresh token đã hết hạn' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ status: 'error', message: 'Refresh token không hợp lệ' });
    }
    return res.status(401).json({ status: 'error', message: 'Lỗi xác thực refresh token' });
  }
});

module.exports = router;
