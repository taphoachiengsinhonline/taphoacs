// routes/authRoutes.js
// Thêm các middleware và cấu hình cần thiết
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Thêm middleware kiểm tra JSON
//router.use(express.json());

// Register - Phiên bản đã sửa
router.post('/register', async (req, res) => {
  try {
    console.log('📥 Request headers:', req.headers);
    console.log('📥 Raw body:', req.body);
    
    const { email, password, name } = req.body;

    // Validate input
    if (!email || !password || !name) {
      console.log('⚠️ Thiếu thông tin:', { email, name });
      return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin' });
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.log('⚠️ Email không hợp lệ:', email);
      return res.status(400).json({ message: 'Email không hợp lệ' });
    }

    console.log('🔍 Checking existing user...');
    const existing = await User.findOne({ email }).maxTimeMS(5000);
    
    if (existing) {
      console.log('⛔ Email đã tồn tại:', email);
      return res.status(409).json({ message: 'Email đã được đăng ký' });
    }

    console.log('🔐 Hashing password...');
    const hashed = await bcrypt.hash(password, 10);
    
    console.log('👤 Creating user...');
    const user = await User.create({ 
      email: email.toLowerCase().trim(),
      password: hashed,
      name: name.trim()
    });

    console.log('✅ User created:', user);
    
    res.status(201).json({
      message: 'Đăng ký thành công',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
      }
    });

  } catch (err) {
    console.error('❌ ERROR DETAILS:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    
    // Xử lý lỗi MongoDB
    if (err.name === 'MongoServerError') {
      return res.status(500).json({ 
        message: 'Lỗi cơ sở dữ liệu',
        error: err.message 
      });
    }
    
    res.status(500).json({ 
      message: 'Lỗi hệ thống',
      error: err.message 
    });
  }
});
