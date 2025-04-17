// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email đã tồn tại' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed, name });
    res.status(201).json({ message: 'Đăng ký thành công', user: { ...user.toObject(), password: undefined } });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server khi đăng ký', error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password, expoPushToken } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Sai tài khoản hoặc mật khẩu' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Sai tài khoản hoặc mật khẩu' });

    user.expoPushToken = expoPushToken;
    await user.save();

    res.json({ message: 'Đăng nhập thành công', user: { ...user.toObject(), password: undefined } });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server khi đăng nhập', error: err.message });
  }
});

module.exports = router;
