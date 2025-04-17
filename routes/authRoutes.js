// routes/authRoutes.js
const express = require('express');
const router = express.Router(); // Khởi tạo router đúng cách
const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Đăng ký
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Check existing user
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'Email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = await User.create({
      name,
      email: email.toLowerCase().trim(),
      password: hashedPassword
    });

    // Return response
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ 
      message: 'Server error',
      error: err.message 
    });
  }
});

module.exports = router; // Export router chính xác
