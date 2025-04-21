// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); // Thêm thư viện JWT
const User = require('../models/User');

// Đăng ký - GIỮ NGUYÊN CHỨC NĂNG CŨ VÀ SỬA LỖI
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, address, phone } = req.body;
        
        // Validate input
        if (!name || !email || !password) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ các mục' });
        }

        // Check existing user
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ message: 'Email đã tồn tại' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user - SỬA LỖI: sử dụng hashedPassword thay vì password gốc
        const user = new User({
            name: name,
            email: email,
            password: hashedPassword, // Sửa thành hashedPassword
            address: address || '', // Thêm giá trị mặc định
            phone: phone || '' // Thêm giá trị mặc định
        });

        // Lưu user vào database
        await user.save();

        // Return response
        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            address: user.address,
            phone: user.phone
        });

    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ 
            message: 'Lỗi server',
            error: err.message 
        });
    }
});

// THÊM CHỨC NĂNG ĐĂNG NHẬP MỚI
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Kiểm tra input
        if (!email || !password) {
            return res.status(400).json({ message: 'Vui lòng nhập email và mật khẩu' });
        }

        // Tìm user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
        }

        // So sánh mật khẩu
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
        }

        // Tạo JWT token
        const token = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET || 'your-secret-key', // Nên dùng biến môi trường
            { expiresIn: '1h' }
        );

        // Trả về thông tin user (không bao gồm password)
        res.json({
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                address: user.address,
                phone: user.phone
            },
            token: token
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Lỗi server' });
    }
});

module.exports = router;
