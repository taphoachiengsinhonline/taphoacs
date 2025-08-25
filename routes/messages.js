// File: backend/routes/messages.js
// PHIÊN BẢN NÂNG CẤP - Lọc SĐT nâng cao

const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { verifyToken } = require('../middlewares/authMiddleware');
const { safeNotify } = require('../utils/notificationMiddleware');
const { sendMessage } = require('../services/messageService');
// --- BẮT ĐẦU HÀM LỌC NÂNG CAO ---

// --- BỘ LỌC SỐ ĐIỆN THOẠI NÂNG CAO ---

// Hàm bỏ dấu tiếng Việt
const removeVietnameseTones = (str) => {
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
    str = str.replace(/đ/g, "d");
    return str;
};

// Từ điển "dịch" chữ sang số
const wordToDigitMap = {
    'khong': '0', 'không': '0', 'zero': '0',
    'mot': '1', 'một': '1', 'one': '1',
    'hai': '2', 'two': '2',
    'ba': '3', 'three': '3',
    'bon': '4', 'bốn': '4', 'tu': '4', 'tư': '4', 'four': '4',
    'nam': '5', 'năm': '5', 'five': '5',
    'sau': '6', 'sáu': '6', 'six': '6',
    'bay': '7', 'bảy': '7', 'seven': '7',
    'tam': '8', 'tám': '8', 'eight': '8',
    'chin': '9', 'chín': '9', 'nine': '9'
};

const containsPhoneNumber = (text) => {
    // 1. Chuẩn hóa: chữ thường, bỏ dấu cách, bỏ dấu tiếng Việt
    let processedText = removeVietnameseTones(text.toLowerCase());
    
    // 2. "Dịch" chữ sang số
    for (const word in wordToDigitMap) {
        // Dùng regex với global flag 'g' để thay thế tất cả các lần xuất hiện
        processedText = processedText.replace(new RegExp(word, 'g'), wordToDigitMap[word]);
    }

    // 3. Làm sạch cuối cùng: chỉ giữ lại số
    const onlyDigits = processedText.replace(/\D/g, '');

    // 4. Kiểm tra bằng Regex trên chuỗi số đã được "dịch"
    // Regex tìm SĐT Việt Nam (10 chữ số, bắt đầu bằng 0)
    const phoneRegex = /^0\d{9}$/;
    
    // Nếu chuỗi số dài hơn 9 và chứa một SĐT hợp lệ
    if (onlyDigits.length >= 10) {
        // Thử tìm các chuỗi con 10 chữ số
        for (let i = 0; i <= onlyDigits.length - 10; i++) {
            const sub = onlyDigits.substring(i, i + 10);
            if (phoneRegex.test(sub)) {
                console.log(`[Phone Filter] Detected phone number: ${sub} from text: "${text}"`);
                return true;
            }
        }
    }

    return false;
};
// --- Route để lấy tin nhắn của một cuộc trò chuyện ---
router.get('/:conversationId', verifyToken, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user._id;

        // 1. Kiểm tra xem cuộc trò chuyện có tồn tại không
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện.' });
        }

        // 2. Kiểm tra xem người dùng hiện tại có phải là thành viên của cuộc trò chuyện không
        const isParticipant = conversation.customerId.equals(userId) || conversation.sellerId.equals(userId);
        if (!isParticipant) {
            return res.status(403).json({ message: 'Bạn không có quyền xem cuộc trò chuyện này.' });
        }

        // 3. Lấy tất cả tin nhắn và populate thông tin người gửi
        const messages = await Message.find({ conversationId })
            .sort({ createdAt: 'asc' }) // Sắp xếp theo thời gian tăng dần (tin cũ -> mới)
            .populate('senderId', 'name role avatar shopProfile.avatar'); // Lấy thêm avatar

        // 4. Đánh dấu các tin nhắn là đã đọc cho người dùng hiện tại
        // (Logic này rất quan trọng để reset badge đếm tin nhắn)
        if (conversation.customerId.equals(userId)) {
            // Nếu người dùng là khách hàng, reset unreadByCustomer
            if (conversation.unreadByCustomer > 0) {
                conversation.unreadByCustomer = 0;
                await conversation.save();
            }
        } else if (conversation.sellerId.equals(userId)) {
            // Nếu người dùng là người bán, reset unreadBySeller
            if (conversation.unreadBySeller > 0) {
                conversation.unreadBySeller = 0;
                await conversation.save();
            }
        }

        // 5. Trả về danh sách tin nhắn cho client
        res.json(messages);

    } catch (err) {
        console.error("Lỗi khi lấy tin nhắn:", err.message);
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// --- Route để gửi tin nhắn mới (ÁP DỤNG BỘ LỌC) ---
router.post('/', verifyToken, async (req, res) => {
    try {
        const { conversationId, content, messageType, data } = req.body;
        const senderId = req.user._id;

        // Gọi hàm service để xử lý tất cả logic
        const message = await sendMessage({
            conversationId,
            senderId,
            content,
            messageType,
            data
        });
        
        const populatedMessage = await Message.findById(message._id).populate('senderId', 'name role');
        res.status(201).json(populatedMessage);

    } catch (err) {
        console.error('[MESSAGE POST Route] Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi server khi gửi tin nhắn' });
    }
});

module.exports = router;
