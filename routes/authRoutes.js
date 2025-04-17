const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Thêm middleware router-specific
router.use((req, res, next) => {
  console.log('🕒 Thời gian request:', new Date().toISOString());
  next();
});

// Đăng ký - Phiên bản đã fix
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validate input
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Thiếu thông tin đăng ký' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email đã tồn tại' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ 
      email: email.toLowerCase().trim(),
      password: hashed,
      name: name.trim()
    });

    res.status(201).json({
      message: 'Đăng ký thành công',
      user: { ...user.toObject(), password: undefined },
    });
  } catch (err) {
    console.error('❌ Lỗi đăng ký:', {
      message: err.message,
      stack: err.stack
    });
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

module.exports = router; // Export router chính xác
