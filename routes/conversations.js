// File: backend/routes/conversations.js

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');

// Import controller vừa tạo
const conversationController = require('../controllers/conversationController');

// --- Định nghĩa các route ---

// Tạo/tìm cuộc trò chuyện
router.post('/', verifyToken, conversationController.findOrCreateConversation);

// Đếm tin nhắn chưa đọc
router.get('/unread/count', verifyToken, conversationController.getUnreadCount);

// Lấy danh sách chat đã gom nhóm
router.get('/grouped', verifyToken, conversationController.getGroupedConversations);

// Lấy danh sách chat chưa gom nhóm (dùng cho UserConversationListScreen)
router.get('/', verifyToken, conversationController.getConversationsList);

// Lấy chi tiết một cuộc trò chuyện (phải đặt cuối cùng)
router.get('/:id', verifyToken, conversationController.getConversationById);


module.exports = router;
