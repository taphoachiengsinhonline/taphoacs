// routes/messages.js

const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { verifyToken } = require('../middlewares/authMiddleware');
const { safeNotify } = require('../utils/notificationMiddleware');

// ==============================================================================
// ===             LẤY TẤT CẢ TIN NHẮN CỦA MỘT CUỘC TRÒ CHUYỆN              ===
// ==============================================================================
router.get('/:conversationId', verifyToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    // 1. Tìm cuộc trò chuyện
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện.' });
    }

    // 2. Xác thực quyền: User phải là khách hàng hoặc seller của cuộc trò chuyện này
    const isCustomer = conversation.customerId.equals(userId);
    const isSeller = conversation.sellerId.equals(userId);

    if (!isCustomer && !isSeller) {
      return res.status(403).json({ message: 'Bạn không có quyền xem cuộc trò chuyện này.' });
    }

    // 3. Lấy tất cả tin nhắn và sắp xếp theo thời gian cũ nhất lên trên để FlatList inverted hoạt động đúng
    const messages = await Message.find({ conversationId })
      .sort({ createdAt: -1 }) // Sắp xếp giảm dần (mới nhất ở đầu) để FlatList inverted hiển thị đúng
      .populate('senderId', 'name role'); // Lấy thêm role để biết ai là người gửi

    res.json(messages);

  } catch (err) {
    console.error('[GET /messages] Lỗi:', err.message);
    res.status(500).json({ message: 'Lỗi server' });
  }
});


// ==============================================================================
// ===                      GỬI MỘT TIN NHẮN MỚI                              ===
// ==============================================================================
router.post('/', verifyToken, async (req, res) => {
  try {
    const { conversationId, content } = req.body;
    const senderId = req.user._id;

    if (!conversationId || !content) {
      return res.status(400).json({ message: 'Thiếu thông tin cần thiết.' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện.' });
    }

    // Xác thực người gửi phải là một trong hai người trong cuộc trò chuyện
    const isParticipant = conversation.customerId.equals(senderId) || conversation.sellerId.equals(senderId);
    if (!isParticipant) {
      return res.status(403).json({ message: 'Bạn không có quyền gửi tin nhắn vào cuộc trò chuyện này.' });
    }

    // Tạo và lưu tin nhắn mới
    const message = new Message({
      conversationId,
      senderId,
      content
    });
    await message.save();

    // Cập nhật lại trường `updatedAt` của conversation để nó nổi lên đầu danh sách
    conversation.updatedAt = new Date();
    await conversation.save();

    // Lấy thông tin đầy đủ của tin nhắn vừa tạo để trả về cho client
    const populatedMessage = await Message.findById(message._id)
      .populate('senderId', 'name role');

    // <<< LOGIC GỬI THÔNG BÁO CHO NGƯỜI NHẬN >>>
    let recipientId;
    if (conversation.customerId.equals(senderId)) {
        // Nếu người gửi là khách hàng, người nhận là seller
        recipientId = conversation.sellerId;
    } else {
        // Nếu người gửi là seller, người nhận là khách hàng
        recipientId = conversation.customerId;
    }

    const recipient = await User.findById(recipientId).select('fcmToken');
    if (recipient && recipient.fcmToken) {
        await safeNotify(recipient.fcmToken, {
            title: `Tin nhắn mới từ ${req.user.name}`,
            body: content,
            data: {
                type: 'new_message',
                conversationId: conversationId.toString(),
            }
        });
    }
    
    res.status(201).json(populatedMessage);

  } catch (err) {
    console.error('[POST /messages] Lỗi:', err.message);
    res.status(500).json({ message: 'Lỗi server' });
  }
});


module.exports = router;
