// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const voucherController = require('../controllers/voucherController');
const { verifyToken } = require('../middlewares/authMiddleware');

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
    if (user.role === 'customer') {
      await voucherController.grantNewUserVoucher(user._id);
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
        refreshToken
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

   const allowedRoles = {
    customer: ['customer', 'admin'], // App khách hàng cho phép user và admin
    shipper: ['shipper'],             // App shipper chỉ cho shipper
    seller: ['seller']                // App seller chỉ cho seller
};

// client_type được gửi từ frontend, ví dụ: 'customer', 'shipper', 'seller'
const requestClientType = client_type || 'customer'; 

if (!allowedRoles[requestClientType] || !allowedRoles[requestClientType].includes(user.role)) {
    console.log(`[DEBUG] Role không hợp lệ. client_type: ${requestClientType}, user.role: ${user.role}`);
    return res.status(403).json({
        status: 'error',
        message: 'Tài khoản của bạn không có quyền truy cập vào ứng dụng này.'
    });
}
// ===== KẾT THÚC LOGIC KIỂM TRA =====

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
  console.log('[DEBUG] Refresh token request:', { refreshToken: refreshToken ? 'Provided' : 'Missing' });

  if (!refreshToken) {
    return res.status(400).json({ status: 'error', message: 'Thiếu refresh token' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    console.log('[DEBUG] Decoded refresh token:', decoded);

    const user = await User.findById(decoded.userId);
    if (!user) {
      console.log('[DEBUG] User not found for ID:', decoded.userId);
      return res.status(401).json({ status: 'error', message: 'Người dùng không tồn tại' });
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id);
    console.log('[DEBUG] New tokens generated:', { accessToken: 'Generated', refreshToken: 'Generated' });

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
      return res.status(401).json({ status: 'error', message: 'Refresh token đã hết hạn, vui lòng đăng nhập lại' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ status: 'error', message: 'Refresh token không hợp lệ, vui lòng đăng nhập lại' });
    }
    return res.status(401).json({ status: 'error', message: 'Lỗi xác thực refresh token' });
  }
});

router.get('/me', verifyToken, async (req, res) => {
    try {
        // req.user đã được gán bởi middleware verifyToken
        // Trả về thông tin user (không bao gồm password)
        res.status(200).json({
            status: 'success',
            data: {
                user: req.user 
            }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Lỗi server' });
    }
});


module.exports = router;
