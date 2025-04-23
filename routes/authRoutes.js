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

        if (!name || !email || !password) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Vui lòng điền đầy đủ các mục' 
            });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ 
                status: 'error', 
                message: 'Email đã tồn tại' 
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = new User({
            name,
            email,
            password: hashedPassword,
            address: address || '',
            phone: phone || ''
        });

        await user.save();

        return res.status(201).json({
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
        return res.status(500).json({
            status: 'error',
            message: 'Lỗi server',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Đăng nhập
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                status: 'error',
                message: 'Vui lòng nhập email và mật khẩu'
            });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Email hoặc mật khẩu không đúng'
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({
                status: 'error',
                message: 'Email hoặc mật khẩu không đúng'
            });
        }

        const token = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET || 'fallback_secret_key',
            { expiresIn: '1h' }
        );

        return res.status(200).json({
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
                token
            }
        });

    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Lỗi server',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

module.exports = router;
