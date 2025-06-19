// routes/conversations.js
const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');


// Lấy danh sách hội thoại của khách
router.get('/', async (req, res) => {
  try {
    const { customerId } = req.query;
    const conversations = await Conversation.find({ customerId })
      .populate('productId')
      .populate('customerId')
      .populate('adminId');
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tạo hội thoại mới
router.post('/', async (req, res) => {
  try {
    const { productId, customerId, adminId } = req.body;
    const conversation = new Conversation({ productId, customerId, adminId });
    await conversation.save();
    res.json(conversation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
