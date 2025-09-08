const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { safeNotify } = require('../utils/notificationMiddleware');

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
    let processedText = removeVietnameseTones(text.toLowerCase());
    
    for (const word in wordToDigitMap) {
        processedText = processedText.replace(new RegExp(word, 'g'), wordToDigitMap[word]);
    }

    const onlyDigits = processedText.replace(/\D/g, '');

    const phoneRegex = /^0\d{9}$/;
    if (onlyDigits.length >= 10) {
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

// --- HÀM GỬI TIN NHẮN TRUNG TÂM ---
exports.sendMessage = async ({ conversationId, senderId, content, messageType = 'text', data = {} }) => {
    try {
        if (!conversationId || !senderId || !content) {
            throw new Error("Thiếu thông tin cần thiết để gửi tin nhắn.");
        }

        // --- ÁP DỤNG BỌ LỌC TẠI ĐÂY ---
        if (messageType === 'text' && containsPhoneNumber(content)) {
            content = "[Thông tin liên lạc đã được ẩn để đảm bảo an toàn cho giao dịch của bạn]";
        }
        
        // 1. Tạo và lưu tin nhắn
        const message = new Message({ conversationId, senderId, content, messageType, data });
        await message.save();

        // 2. Cập nhật lastActive cho sender
        const sender = await User.findById(senderId);
        if (sender) {
            await sender.updateLastActive();
            console.log(`[DEBUG] Updated lastActive for sender ${senderId} to ${sender.role === 'seller' ? sender.shopProfile.lastActive : sender.lastActive}`);
        } else {
            console.log(`[DEBUG] Sender ${senderId} not found, skipping lastActive update`);
        }

        // 3. Cập nhật conversation và gửi notification (fire-and-forget)
        (async () => {
            try {
                const conversation = await Conversation.findById(conversationId)
                    .populate('customerId', 'name fcmToken')
                    .populate('sellerId', 'name fcmToken');
                
                if (!conversation) return;
                
                let recipient;
                if (conversation.customerId.equals(senderId)) {
                    recipient = conversation.sellerId;
                    conversation.unreadBySeller = (conversation.unreadBySeller || 0) + 1;
                } else {
                    recipient = conversation.customerId;
                    conversation.unreadByCustomer = (conversation.unreadByCustomer || 0) + 1;
                }
                conversation.updatedAt = new Date();
                await conversation.save();

                if (recipient && recipient.fcmToken) {
                    const sender = await User.findById(senderId).select('name');
                    let notificationBody = content;
                    if (messageType === 'image') notificationBody = `${sender.name} đã gửi một hình ảnh.`;
                    else if (notificationBody.length > 100) notificationBody = notificationBody.substring(0, 97) + '...';

                    await safeNotify(recipient.fcmToken, {
                        title: `Tin nhắn mới từ ${sender.name}`,
                        body: notificationBody,
                        data: { type: 'new_message', conversationId: conversationId.toString() }
                    });
                }
            } catch (e) {
                console.error("Lỗi trong tác vụ nền gửi notification tin nhắn:", e);
            }
        })();

        // 4. Trả về tin nhắn đã được tạo
        return message;

    } catch (error) {
        console.error("Lỗi trong messageService.sendMessage:", error);
        throw error;
    }
};
