// File: backend/routes/messages.js
// PHIÊN BẢN NÂNG CẤP - Lọc SĐT nâng cao

const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { verifyToken } = require('../middlewares/authMiddleware');
const { safeNotify } = require('../utils/notificationMiddleware');

// --- BẮT ĐẦU HÀM LỌC NÂNG CAO ---

// Từ điển các từ khóa số
const numberWords = [
    'không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín',
    'khong', 'mot', 'bon', 'sau', 'bay',
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'
];

const containsPhoneNumber = (text) => {
    // 1. Chuẩn hóa chuỗi đầu vào:
    // - Chuyển thành chữ thường
    // - Loại bỏ toàn bộ dấu câu, dấu cách, ký tự đặc biệt
    const normalizedText = text.toLowerCase().replace(/[\s.-]/g, '');

    // 2. Regex để tìm chuỗi số điện thoại (đã được chuẩn hóa)
    // Tìm chuỗi 9-11 chữ số bắt đầu bằng 0, 84, hoặc +84
    const phoneRegex = /(?:\+?84|0)(?:\d{9,10})\b/g;
    if (phoneRegex.test(normalizedText)) {
        console.log(`[Phone Filter] Detected by Regex: ${normalizedText}`);
        return true;
    }

    // 3. Logic phát hiện số viết bằng chữ
    // Đếm số lượng từ khóa số xuất hiện
    let wordCount = 0;
    for (const word of numberWords) {
        if (normalizedText.includes(word)) {
            wordCount++;
        }
    }

    // Nếu có ít nhất 4-5 từ khóa số khác nhau, khả năng cao là SĐT
    if (wordCount >= 5) {
        console.log(`[Phone Filter] Detected by Word Count: ${wordCount} words`);
        return true;
    }

    // 4. Logic kết hợp: Tìm các đoạn số ngắn
    const shortDigitRegex = /\d{2,4}/g; // Tìm các cụm 2-4 chữ số
    const digitChunks = normalizedText.match(shortDigitRegex) || [];
    
    // Nếu tổng độ dài của các cụm số >= 9 và có ít nhất 2 từ khóa số
    const totalDigitLength = digitChunks.join('').length;
    if (totalDigitLength >= 9 && wordCount >= 2) {
        console.log(`[Phone Filter] Detected by Hybrid method: ${totalDigitLength} digits and ${wordCount} words`);
        return true;
    }

    return false;
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

// --- Route để gửi tin nhắn mới (ÁP DỤNG BỘ LỌC) ---
router.post('/', verifyToken, async (req, res) => {
    try {
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

        // ÁP DỤNG BỘ LỌC MỚI
        if ((!messageType || messageType === 'text') && containsPhoneNumber(content)) {
            content = "[Thông tin liên lạc đã được ẩn để đảm bảo an toàn cho giao dịch của bạn]";
        }

        const message = new Message({ 
            conversationId, 
            senderId: sender._id, 
            content, 
            messageType: messageType || 'text',
            data: data || {}
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
                data: { type: 'new_message', conversationId: conversationId.toString() }
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
