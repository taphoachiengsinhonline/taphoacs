const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const auth = require('../middlewares/authMiddleware.js');

// Lấy tin nhắn
router.get('/:conversationId', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    console.log('[Messages] Fetching for conversationId:', conversationId);
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      console.log('[Messages] Conversation not found:', conversationId);
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const messages = await Message.find({ conversationId })
      .populate('senderId', 'username');
    console.log('[Messages] Found:', messages.length);
    res.json(messages);
  } catch (err) {
    console.error('[Messages] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Gửi tin nhắn
router.post('/', auth, async (req, res) => {
  try {
    const { conversationId, content } = req.body;
    console.log('[Messages] Sending:', { conversationId, content });
    if (!conversationId || !content) {
      return res.status(400).json({ error: 'conversationId and content required' });
    }
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      console.log('[Messages] Conversation not found:', conversationId);
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const message = new Message({
      conversationId,
      senderId: req.user._id,
      content
    });
    await message.save();
    const populated = await Message.findById(message._id)
      .populate('senderId', 'username');
    conversation.updatedAt = new Date();
    await conversation.save();
    console.log('[Messages] Sent:', message._id);
    res.json(populated);
  } catch (err) {
    console.error('[Messages] Send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
