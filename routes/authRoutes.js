// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Đăng ký tài khoản
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, address, phone } = req.body;
        
        // Validate input
        if (!name || !email || !password) {
            return res.status(400).json({ 
                status: 'error',
                message: 'Vui lòng điền đầy đủ các mục' 
            });
        }

        // Check existing user
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ 
                status: 'error',
                message: 'Email đã tồn tại' 
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        const user = new User({
            name: name,
            email: email,
            password: hashedPassword,
            address: address || '',
            phone: phone || ''
        });

        // Save to database
        await user.save();

        // Return response
        res.setHeader('Content-Type', 'application/json');
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
        res.setHeader('Content-Type', 'application/json');
        res.status(500).json({ 
            status: 'error',
            message: 'Lỗi server',
            error: process.env.NODE_ENV === 'development' ? err.message : null
        });
    }
});

// Đăng nhập
router.post('/login', async (req, res) => {
    console.log('Login attempt:', req.body); // [!] Thêm dòng này
    try {
        const { email, password } = req.body;
        console.log('Searching for user:', email); // [!] Thêm dòng này
        // Validate input
        if (!email || !password) {
            return res.status(400).json({ 
                status: 'error',
                message: 'Vui lòng nhập email và mật khẩu' 
            });
        }

        // Find user
        const user = await User.findOne({ email });
        console.log('User found:', user); // [!] Thêm dòng này
        if (!user) {
            return res.status(401).json({ 
                status: 'error',
                message: 'Email hoặc mật khẩu không đúng' 
            });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
         console.log('Password match:', isMatch); // [!] Quan trọng
        if (!isMatch) {
            return res.status(401).json({ 
                status: 'error',
                message: 'Email hoặc mật khẩu không đúng' 
                });
        }
        

        // Tạo JWT token
        const token = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET || 'fallback_secret_key',
            { expiresIn: '1h' }
        );
        console.log('Generated Token:', token); // [!] Thêm dòng này để debug
        // Trả về response
        res.setHeader('Content-Type', 'application/json');
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
                token: token
            }
        });

    } catch (err) {
        console.error('Login error:', err);
        res.setHeader('Content-Type', 'application/json');
        res.status(500).json({ 
            status: 'error',
            message: 'Lỗi server',
            error: process.env.NODE_ENV === 'development' ? err.message : null
        });
    }
});

module.exports = router;
