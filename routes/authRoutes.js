const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Đăng ký
router.post('/register', async (req, res) => {
  const { name, email, phone, address, password, expoPushToken } = req.body;

  try {
    // Kiểm tra email đã tồn tại chưa
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email đã được sử dụng' });
    }

    // Mã hoá mật khẩu
    const hashedPassword = await bcrypt.hash(password, 10);

    // Tạo user mới
    const user = new User({
      name,
      email,
      phone,
      address,
      password: hashedPassword,
      expoPushToken // 👈 Lưu token thông báo đẩy nếu có
    });

    await user.save();

    // Tạo JWT token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ user: user.toJSON(), token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Đã xảy ra lỗi server khi đăng ký' });
  }
});

module.exports = router;
