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
    if (!isParticipant) return res.status(403).json({ message: 'Bạn không có quyền xem.' });

    const messages = await Message.find({ conversationId }).sort({ createdAt: -1 }).populate('senderId', 'name role');

    // <<< LOGIC MỚI: ĐÁNH DẤU ĐÃ ĐỌC >>>
    // Khi user mở cuộc trò chuyện, reset bộ đếm của họ về 0
    if (conversation.customerId.equals(userId)) {
        conversation.unreadByCustomer = 0;
    } else if (conversation.sellerId.equals(userId)) {
        conversation.unreadBySeller = 0;
    }
    await conversation.save();
    
    // Đánh dấu tất cả các tin nhắn mà người khác gửi là đã đọc
    await Message.updateMany(
        { conversationId: conversationId, senderId: { $ne: userId } },
        { $set: { isRead: true } }
    );

    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

router.post('/', verifyToken, async (req, res) => {
  try {
    const { conversationId, content } = req.body;
    const senderId = req.user._id;

    if (!conversationId || !content) return res.status(400).json({ message: 'Thiếu thông tin.' });

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện.' });
    
    const isParticipant = conversation.customerId.equals(senderId) || conversation.sellerId.equals(senderId);
    if (!isParticipant) return res.status(403).json({ message: 'Bạn không có quyền gửi tin nhắn vào cuộc trò chuyện này.' });

    const message = new Message({ conversationId, senderId, content });
    await message.save();

    conversation.updatedAt = new Date();

    // <<< LOGIC MỚI: TĂNG BỘ ĐẾM CHO NGƯỜI NHẬN >>>
    let recipientId;
    if (conversation.customerId.equals(senderId)) {
        recipientId = conversation.sellerId;
        conversation.unreadBySeller += 1; // Tăng bộ đếm cho Seller
    } else {
        recipientId = conversation.customerId;
        conversation.unreadByCustomer += 1; // Tăng bộ đếm cho Khách hàng
    }
    await conversation.save();

    const populatedMessage = await Message.findById(message._id).populate('senderId', 'name role');
    
    // Gửi thông báo push
    const recipient = await User.findById(recipientId).select('fcmToken');
    if (recipient?.fcmToken) {
        await safeNotify(recipient.fcmToken, { /* ... */ });
    }
    
    res.status(201).json(populatedMessage);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

module.exports = router;
