// routes/conversations.js
const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { verifyToken } = require('../middlewares/authMiddleware'); // Sửa: Dùng verifyToken

router.get('/', verifyToken, async (req, res) => {
  try {
    const { customerId } = req.query;
    console.log('[Conversations] Fetching for customerId:', customerId);
    if (!customerId) {
      return res.status(400).json({ error: 'customerId required' });
    }
    if (customerId !== req.user._id.toString()) {
      console.log('[Conversations] customerId mismatch:', { customerId, userId: req.user._id });
      return res.status(403).json({ error: 'Unauthorized access' });
    }
    const conversations = await Conversation.find({ customerId })
      .populate('productId', 'name images price')
      .populate('customerId', 'name') // Sửa: Dùng 'name'
      .populate('adminId', 'name');  // Sửa: Dùng 'name'
    console.log('[Conversations] Found:', conversations.length);
    res.json(conversations);
  } catch (err) {
    console.error('[Conversations] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', verifyToken, async (req, res) => {
  try {
    const { productId, customerId } = req.body;
    console.log('[Conversations] Creating:', { productId, customerId });
    if (!productId || !customerId) {
      return res.status(400).json({ error: 'productId and customerId required' });
    }
    if (customerId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      console.log('[Conversations] No admin found');
      return res.status(500).json({ error: 'No admin available' });
    }
    const conversation = new Conversation({
      productId,
      customerId,
      adminId: admin._id
    });
    await conversation.save();
    const populated = await Conversation.findById(conversation._id)
      .populate('productId', 'name images price')
      .populate('customerId', 'name') // Sửa: Dùng 'name'
      .populate('adminId', 'name');  // Sửa: Dùng 'name'
    console.log('[Conversations] Created:', populated._id);
    res.json(populated);
  } catch (err) {
    console.error('[Conversations] Create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
