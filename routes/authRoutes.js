// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Hàm tạo Access + Refresh token
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET, // Sử dụng JWT_REFRESH_SECRET
    { expiresIn: '7d' }
  );
  return { accessToken, refreshToken };
};

// Đăng ký tài khoản
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, address, phone } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ status: 'error', message: 'Vui lòng điền đầy đủ các mục' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ status: 'error', message: 'Email đã tồn tại' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = new User({ name, email, password: hashedPassword, address: address || '', phone: phone || '' });
        await user.save();

        res.status(201).json({
            status: 'success',
            data: {
                _id: user._id,
                name: user.name,
                email: user.email,
                address: user.address,
                phone: user.phone
            }
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ status: 'error', message: 'Lỗi server' });
    }
});

// Đăng nhập
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Vui lòng nhập email và mật khẩu' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ status: 'error', message: 'Email hoặc mật khẩu không đúng' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ status: 'error', message: 'Email hoặc mật khẩu không đúng' });
    }

    const { accessToken, refreshToken } = generateTokens(user._id);

    res.status(200).json({
      status: 'success',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          address: user.address,
          phone: user.phone,
          isAdmin: user.isAdmin || false
        },
        token: accessToken,
        refreshToken: refreshToken
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
    console.warn('[REFRESH_TOKEN] Thiếu refresh token trong body');
    return res.status(400).json({ status: 'error', message: 'Thiếu refresh token' });
  }
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    console.log('[REFRESH_TOKEN] Token hợp lệ, userId:', decoded.userId);
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId);
    return res.status(200).json({
      status: 'success',
      data: {
        token: accessToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    console.error('[REFRESH_TOKEN] Lỗi xác minh token:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    return res.status(401).json({ status: 'error', message: 'Refresh token không hợp lệ' });
  }
});

module.exports = router;
