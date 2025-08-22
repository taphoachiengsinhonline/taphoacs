// File: backend/routes/messages.js
// PHIÊN BẢN 100% ĐẦY ĐỦ

const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { verifyToken } = require('../middlewares/authMiddleware');
const { safeNotify } = require('../utils/notificationMiddleware');

// Hàm regex để tìm số điện thoại Việt Nam, linh hoạt hơn
const containsPhoneNumber = (text) => {
    // Regex này tìm các chuỗi 9-11 chữ số, có thể bắt đầu bằng 0, +84, 84
    // và có thể có dấu cách, chấm, gạch ngang ở giữa.
    const phoneRegex = /(?:(?:\(?(?:0|\+84|84)\)?)(?:[\s.-]?\d{2,}){4,})/g;
    return phoneRegex.test(text);
};

// --- Route để lấy tin nhắn của một cuộc trò chuyện ---
router.get('/:conversationId', verifyToken, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user._id;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện.' });
        }

        const isParticipant = conversation.customerId.equals(userId) || conversation.sellerId.equals(userId);
        if (!isParticipant) {
            return res.status(403).json({ message: 'Bạn không có quyền xem cuộc trò chuyện này.' });
        }

        // Sắp xếp theo thời gian tạo, mới nhất ở cuối
        const messages = await Message.find({ conversationId }).sort({ createdAt: 'asc' }).populate('senderId', 'name role');

        // Khi người dùng vào xem, đánh dấu tất cả tin nhắn là đã đọc cho họ
        if (conversation.customerId.equals(userId)) {
            conversation.unreadByCustomer = 0;
        } else if (conversation.sellerId.equals(userId)) {
            conversation.unreadBySeller = 0;
        }
        await conversation.save();

        // API trả về messages theo thứ tự asc (cũ trước, mới sau)
        // Client sẽ phải reverse() nếu muốn hiển thị ngược lại
        res.json(messages);

    } catch (err) {
        console.error("Lỗi khi lấy tin nhắn:", err.message);
        res.status(500).json({ message: 'Lỗi server khi lấy tin nhắn' });
    }
});

// --- Route để gửi tin nhắn mới ---
router.post('/', verifyToken, async (req, res) => {
    try {
        // Lấy thêm messageType và data từ body
        let { conversationId, content, messageType, data } = req.body;
        const sender = req.user;

        if (!conversationId || !content) {
            return res.status(400).json({ message: 'Thiếu thông tin cuộc trò chuyện hoặc nội dung.' });
        }
        
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

        // --- LOGIC LỌC SỐ ĐIỆN THOẠI ---
        if ((!messageType || messageType === 'text') && containsPhoneNumber(content)) {
            content = "[Chúng tôi đã ẩn thông tin liên lạc để đảm bảo an toàn cho giao dịch của bạn]";
        }

        const message = new Message({ 
            conversationId, 
            senderId: sender._id, 
            content, 
            messageType: messageType || 'text', // Mặc định là 'text'
            data: data || {} // Lưu data nếu có
        });
        await message.save();

        let recipient;
        if (conversation.customerId._id.equals(sender._id)) {
            recipient = conversation.sellerId;
            conversation.unreadBySeller = (conversation.unreadBySeller || 0) + 1;
        } else {
            recipient = conversation.customerId;
            conversation.unreadByCustomer = (conversation.unreadByCustomer || 0) + 1;
        }
        conversation.updatedAt = new Date();
        await conversation.save();
        
        if (recipient && recipient.fcmToken) {
            let notificationBody = content;
            if (messageType === 'image') {
                notificationBody = `${sender.name} đã gửi một hình ảnh.`;
            } else if (notificationBody.length > 100) {
                notificationBody = notificationBody.substring(0, 97) + '...';
            }

            await safeNotify(recipient.fcmToken, {
                title: `Tin nhắn mới từ ${sender.name}`,
                body: notificationBody,
                data: {
                    type: 'new_message',
                    conversationId: conversationId.toString()
                }
            });
        }

        const populatedMessage = await Message.findById(message._id).populate('senderId', 'name role');
        
        res.status(201).json(populatedMessage);

    } catch (err) {
        console.error('[MESSAGE POST] Lỗi nghiêm trọng:', err.message, err.stack);
        res.status(500).json({ message: 'Lỗi server khi gửi tin nhắn' });
    }
});

module.exports = router;
