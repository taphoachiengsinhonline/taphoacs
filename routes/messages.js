const express = require('express');
const router = express.Router();
const Message = require('../models/Message');

// Lấy tin nhắn trong hội thoại
router.get('/:conversationId', async (req, res) => {
  try {
    const messages = await Message.find({ conversationId: req.params.conversationId })
      .populate('senderId');
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gửi tin nhắn mới
router.post('/', async (req, res) => {
  try {
    const { conversationId, senderId, content } = req.body;
    const message = new Message({ conversationId, senderId, content });
    await message.save();
    res.json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
