const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const Product = require('../models/Product');
const Message = require('../models/Message');
const mongoose = require('mongoose'); // <<< THÊM DÒNG NÀY VÀO ĐÂY
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
            { $set: { updatedAt: new Date() } },
            { new: true, upsert: true }
        );
        
        // isNew không phải là thuộc tính chuẩn, dùng status 200/201 dựa trên created
        // Tuy nhiên, logic cũ của bạn vẫn chấp nhận được.
        res.status(conversation.isNew ? 201 : 200).json(conversation);

    } catch (err) {
        console.error('[CONVERSATION POST] Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi server' });
    }
});


// API đếm tổng số tin nhắn chưa đọc
router.get('/unread/count', verifyToken, async (req, res) => {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;
        
        let filter, groupField;

        if (userRole === 'seller') {
            filter = { sellerId: new mongoose.Types.ObjectId(userId) };
            groupField = '$unreadBySeller';
        } else { // customer
            filter = { customerId: new mongoose.Types.ObjectId(userId) };
            groupField = '$unreadByCustomer';
        }

        const result = await Conversation.aggregate([
            { $match: filter },
            { $group: { _id: null, totalUnread: { $sum: groupField } } }
        ]);

        const count = result[0]?.totalUnread || 0;
        res.json({ count });

    } catch (error) {
        console.error('[UNREAD COUNT] Lỗi:', error.message);
        res.status(500).json({ message: "Lỗi server" });
    }
});

// API LẤY DANH SÁCH CHAT ĐÃ GOM NHÓM
router.get('/grouped', verifyToken, async (req, res) => {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;

        let matchStage, groupStage, otherUserField, unreadField;

        if (userRole === 'seller') {
            matchStage = { sellerId: new mongoose.Types.ObjectId(userId) };
            otherUserField = '$customerId';
            unreadField = '$unreadBySeller';
        } else { // customer
            matchStage = { customerId: new mongoose.Types.ObjectId(userId) };
            otherUserField = '$sellerId';
            unreadField = '$unreadByCustomer';
        }

        const pipeline = [
            { $match: matchStage },
            { $sort: { updatedAt: -1 } },
            {
                $group: {
                    _id: otherUserField,
                    totalUnread: { $sum: unreadField },
                    lastConversation: { $first: '$$ROOT' }
                }
            },
            { $sort: { 'lastConversation.updatedAt': -1 } },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'otherUser' } },
            { $unwind: { path: '$otherUser', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'messages', localField: 'lastConversation._id', foreignField: 'conversationId', as: 'messages' } },
            { $addFields: { lastMessageObject: { $last: '$messages' } } },
            {
                $project: {
                    _id: 1,
                    totalUnread: 1,
                    lastMessageContent: { $ifNull: ['$lastMessageObject.content', 'Bắt đầu trò chuyện'] },
                    lastUpdatedAt: '$lastConversation.updatedAt',
                    'otherUser._id': 1,
                    'otherUser.name': 1,
                    'otherUser.avatar': 1
                }
            }
        ];

        const groupedConversations = await Conversation.aggregate(pipeline);
        res.json(groupedConversations);

    } catch (err) {
        console.error('[CONVERSATION GROUPED GET] LỖI CHI TIẾT:', err);
        res.status(500).json({ message: 'Lỗi server khi gom nhóm trò chuyện.' });
    }
});


// API để lấy danh sách các cuộc trò chuyện (chưa gom nhóm, dùng cho màn hình chi tiết)
router.get('/', verifyToken, async (req, res) => {
    try {
        const { customerId, sellerId } = req.query;
        const query = {};

        if (customerId) query.customerId = customerId;
        if (sellerId) query.sellerId = sellerId;
        
        const conversations = await Conversation.find(query)
            .populate('customerId', 'name')
            .populate('sellerId', 'name')
            .populate('productId', 'name images price variantTable')
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
    } catch (err)
    {
        console.error('[CONVERSATION GET LIST] Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi server' });
    }
});


// API lấy chi tiết một cuộc trò chuyện (phải nằm cuối cùng)
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id)
            .populate('sellerId', 'name')
            .populate('productId', 'name images price variantTable');
            
        if (!conversation) return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện' });
        
        res.json(conversation);
    } catch (err) {
        console.error('[CONVERSATION GET DETAIL BY ID] Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi server' });
    }
});

module.exports = router;
