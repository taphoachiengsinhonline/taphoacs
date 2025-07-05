// routes/conversations.js (Backend)

const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const Product = require('../models/Product');
const Message = require('../models/Message');
const { verifyToken } = require('../middlewares/authMiddleware');

// API để Khách hàng hoặc Seller tạo/tìm cuộc trò chuyện
router.post('/', verifyToken, async (req, res) => {
    try {
        const { productId, sellerId } = req.body;
        const customerId = req.user._id;

        if (!productId || !sellerId) {
            return res.status(400).json({ message: 'Thiếu thông tin sản phẩm hoặc người bán.' });
        }

        let conversation = await Conversation.findOneAndUpdate(
            { productId, customerId, sellerId },
            { $set: { updatedAt: new Date() } }, // Cập nhật để nó nổi lên đầu
            { new: true, upsert: true } // upsert: true sẽ tạo mới nếu không tìm thấy
        );
        
        res.status(conversation.isNew ? 201 : 200).json(conversation);

    } catch (err) {
        console.error('[CONVERSATION POST] Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi server' });
    }
});


// API để lấy danh sách các cuộc trò chuyện (dùng cho cả Khách hàng và Seller)
router.get('/', verifyToken, async (req, res) => {
    try {
        const { customerId, sellerId } = req.query;
        const query = {};

        if (customerId) query.customerId = customerId;
        if (sellerId) query.sellerId = sellerId;
        
        const conversations = await Conversation.find(query)
            .populate('customerId', 'name')
            .populate('sellerId', 'name')
            .populate('productId', 'name images price variantTable') // Lấy đủ thông tin giá
            .sort({ updatedAt: -1 });

        const conversationsWithLastMessage = await Promise.all(
            conversations.map(async (conv) => {
                const lastMessage = await Message.findOne({ conversationId: conv._id }).sort({ createdAt: -1 });
                return {
                    ...conv.toObject(),
                    lastMessage: lastMessage ? lastMessage.toObject() : null
                };
            })
        );
        
        res.json(conversationsWithLastMessage);
    } catch (err) {
        console.error('[CONVERSATION GET LIST] Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi server' });
    }
});


// API lấy chi tiết một cuộc trò chuyện
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id)
            .populate('sellerId', 'name')
            .populate('productId', 'name images price variantTable'); // Lấy đủ thông tin giá
            
        if (!conversation) return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện' });
        
        // Logic xác thực quyền ở đây nếu cần
        
        res.json(conversation);
    } catch (err) {
        console.error('[CONVERSATION GET DETAIL] Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi server' });
    }
});

module.exports = router;
