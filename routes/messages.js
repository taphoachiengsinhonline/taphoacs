const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User'); // Cần để populate
const { verifyToken } = require('../middlewares/authMiddleware');

// <<< SỬA: Import đúng hàm safeNotify từ file của bạn >>>
const { safeNotify } = require('../utils/notificationMiddleware');

// --- Route để lấy tin nhắn ---
router.get('/:conversationId', verifyToken, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user._id;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện.' });

        const isParticipant = conversation.customerId.equals(userId) || conversation.sellerId.equals(userId);
        if (!isParticipant) return res.status(403).json({ message: 'Bạn không có quyền xem.' });

        const messages = await Message.find({ conversationId }).sort({ createdAt: 'desc' }).populate('senderId', 'name role');

        // Đánh dấu đã đọc
        if (conversation.customerId.equals(userId)) {
            conversation.unreadByCustomer = 0;
        } else if (conversation.sellerId.equals(userId)) {
            conversation.unreadBySeller = 0;
        }
        await conversation.save();

        res.json(messages);
    } catch (err) {
        console.error("Lỗi khi lấy tin nhắn:", err.message);
        res.status(500).json({ message: 'Lỗi server' });
    }
});


// --- Route để gửi tin nhắn MỚI ---
router.post('/', verifyToken, async (req, res) => {
    try {
        const { conversationId, content } = req.body;
        const sender = req.user; // sender là object user đầy đủ từ verifyToken

        if (!conversationId || !content) {
            return res.status(400).json({ message: 'Thiếu thông tin.' });
        }

        // Populate để lấy được FcmToken của cả 2 bên
        const conversation = await Conversation.findById(conversationId)
            .populate('customerId', 'name fcmToken')
            .populate('sellerId', 'name fcmToken');
            
        if (!conversation) {
            return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện.' });
        }

        const isParticipant = conversation.customerId._id.equals(sender._id) || conversation.sellerId._id.equals(sender._id);
        if (!isParticipant) {
            return res.status(403).json({ message: 'Bạn không có quyền gửi tin nhắn vào cuộc trò chuyện này.' });
        }

        // 1. Tạo và lưu tin nhắn
        const message = new Message({ conversationId, senderId: sender._id, content });
        await message.save();

        // 2. Cập nhật cuộc trò chuyện và xác định người nhận
        let recipient;
        if (conversation.customerId._id.equals(sender._id)) {
            recipient = conversation.sellerId;
            conversation.unreadBySeller = (conversation.unreadBySeller || 0) + 1;
        } else {
            recipient = conversation.customerId;
            conversation.unreadByCustomer = (conversation.unreadByCustomer || 0) + 1;
        }
        await conversation.save();
        
        // 3. <<< KHÔI PHỤC LOGIC GỬI THÔNG BÁO - DÙNG ĐÚNG HÀM CỦA BẠN >>>
        if (recipient && recipient.fcmToken) {
            await safeNotify(recipient.fcmToken, {
                title: `Tin nhắn mới từ ${sender.name}`,
                body: content.length > 100 ? content.substring(0, 97) + '...' : content,
                // Gửi thêm data để app có thể điều hướng đến đúng màn hình chat
                data: {
                    type: 'new_message',
                    conversationId: conversationId.toString()
                }
            });
        } else {
            console.log(`Bỏ qua gửi thông báo: Người nhận ${recipient.name} không có FCM token.`);
        }

        // 4. Populate tin nhắn để trả về cho client
        const populatedMessage = await Message.findById(message._id).populate('senderId', 'name role');
        
        // 5. Trả về kết quả
        res.status(201).json(populatedMessage);

    } catch (err) {
        console.error('[MESSAGE POST] Lỗi nghiêm trọng:', err.message, err.stack);
        res.status(500).json({ message: 'Lỗi server' });
    }
});

module.exports = router;
