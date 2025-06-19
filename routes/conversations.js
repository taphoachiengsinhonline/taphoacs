// routes/conversations.js
const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Middleware auth
const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
    req.user = await User.findById(decoded.id);
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Lấy hội thoại
router.get('/', auth, async (req, res) => {
  try {
    const { customerId } = req.query;
    if (!customerId) return res.status(400).json({ error: 'customerId required' });
    const conversations = await Conversation.find({ customerId })
      .populate('productId', 'name images price')
      .populate('customerId', 'username')
      .populate('adminId', 'username');
    res.json(conversations);
  } catch (err) {
    console.error('Get conversations error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Tạo hội thoại
router.post('/', auth, async (req, res) => {
  try {
    const { productId, customerId } = req.body;
    if (!productId || !customerId) {
      return res.status(400).json({ error: 'productId and customerId required' });
    }
    // Tìm admin bất kỳ
    const admin = await User.findOne({ isAdmin: true });
    if (!admin) return res.status(500).json({ error: 'No admin available' });
    const conversation = new Conversation({
      productId,
      customerId,
      adminId: admin._id
    });
    await conversation.save();
    const populated = await Conversation.findById(conversation._id)
      .populate('productId', 'name images price')
      .populate('customerId', 'username')
      .populate('adminId', 'username');
    res.json(populated);
  } catch (err) {
    console.error('Create conversation error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
