// routes/messages.js (Backend)

const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { verifyToken } = require('../middlewares/authMiddleware');
const { safeNotify } = require('../utils/notificationMiddleware');

router.get('/:conversationId', verifyToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện.' });

    const isParticipant = conversation.customerId.equals(userId) || conversation.sellerId.equals(userId);
    if (!isParticipant) return res.status(403).json({ message: 'Bạn không có quyền xem cuộc trò chuyện này.' });

    const messages = await Message.find({ conversationId }).sort({ createdAt: -1 }).populate('senderId', 'name role');
    res.json(messages);
  } catch (err) {
    console.error('[GET /messages] Lỗi:', err.message);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

router.post('/', verifyToken, async (req, res) => {
  try {
    const { conversationId, content } = req.body;
    const senderId = req.user._id;

    if (!conversationId || !content) return res.status(400).json({ message: 'Thiếu thông tin cần thiết.' });

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện.' });

    const isParticipant = conversation.customerId.equals(senderId) || conversation.sellerId.equals(senderId);
    if (!isParticipant) return res.status(403).json({ message: 'Bạn không có quyền gửi tin nhắn vào cuộc trò chuyện này.' });

    const message = new Message({ conversationId, senderId, content });
    await message.save();

    conversation.updatedAt = new Date();
    await conversation.save();

    const populatedMessage = await Message.findById(message._id).populate('senderId', 'name role');
    
    let recipientId = conversation.customerId.equals(senderId) ? conversation.sellerId : conversation.customerId;
    const recipient = await User.findById(recipientId).select('fcmToken');
    if (recipient && recipient.fcmToken) {
        await safeNotify(recipient.fcmToken, {
            title: `Tin nhắn mới từ ${req.user.name}`,
            body: content,
            data: { type: 'new_message', conversationId: conversationId.toString() }
        });
    }
    
    res.status(201).json(populatedMessage);
  } catch (err) {
    console.error('[POST /messages] Lỗi:', err.message);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

module.exports = router;
