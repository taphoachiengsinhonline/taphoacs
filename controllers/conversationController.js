// controllers/conversationController.js

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Order = require('../models/Order'); // Import Order model
const User = require('../models/User'); // Import User model
const mongoose = require('mongoose');

// API để Khách hàng hoặc Seller tạo/tìm cuộc trò chuyện
exports.findOrCreateConversation = async (req, res) => {
    try {
        const { productId, sellerId } = req.body;
        const customerId = req.user._id;

        if (!productId || !sellerId) {
            return res.status(400).json({ message: 'Thiếu thông tin sản phẩm hoặc người bán.' });
        }
        
        // Dùng findOne + save thay vì findOneAndUpdate để biết là tạo mới hay không
        let conversation = await Conversation.findOne({ productId, customerId, sellerId });
        let isNew = false;
        if (!conversation) {
            conversation = new Conversation({ productId, customerId, sellerId });
            isNew = true;
        }
        conversation.updatedAt = new Date();
        await conversation.save();
        
        res.status(isNew ? 201 : 200).json(conversation);

    } catch (err) {
        console.error('[CONVERSATION POST] Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// API đếm tổng số tin nhắn chưa đọc
exports.getUnreadCount = async (req, res) => {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;
        
        const filter = userRole === 'seller' 
            ? { sellerId: new mongoose.Types.ObjectId(userId) }
            : { customerId: new mongoose.Types.ObjectId(userId) };
            
        const groupField = userRole === 'seller' ? '$unreadBySeller' : '$unreadByCustomer';

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
};

// API LẤY DANH SÁCH CHAT ĐÃ GOM NHÓM
exports.getGroupedConversations = async (req, res) => {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;

        const matchStage = userRole === 'seller' 
            ? { sellerId: new mongoose.Types.ObjectId(userId) }
            : { customerId: new mongoose.Types.ObjectId(userId) };
            
        const otherUserField = userRole === 'seller' ? '$customerId' : '$sellerId';
        const unreadField = userRole === 'seller' ? '$unreadBySeller' : '$unreadByCustomer';

        const pipeline = [
            { $match: matchStage }, { $sort: { updatedAt: -1 } },
            { $group: { _id: otherUserField, totalUnread: { $sum: unreadField }, lastConversation: { $first: '$$ROOT' } } },
            { $sort: { 'lastConversation.updatedAt': -1 } },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'otherUser' } },
            { $unwind: '$otherUser' },
            { $lookup: { from: 'messages', localField: 'lastConversation._id', foreignField: 'conversationId', as: 'messages' } },
            { $addFields: { lastMessageObject: { $last: '$messages' } } },
            { $project: {
                _id: 1, totalUnread: 1,
                lastMessageContent: { $ifNull: ['$lastMessageObject.content', 'Bắt đầu trò chuyện'] },
                lastUpdatedAt: '$lastConversation.updatedAt',
                'otherUser._id': 1, 'otherUser.name': 1, 'otherUser.avatar': 1
            }}
        ];

        const groupedConversations = await Conversation.aggregate(pipeline);
        res.json(groupedConversations);

    } catch (err) {
        console.error('[CONVERSATION GROUPED GET] Lỗi:', err);
        res.status(500).json({ message: 'Lỗi server khi gom nhóm trò chuyện.' });
    }
};

// API để lấy danh sách các cuộc trò chuyện (chưa gom nhóm)
exports.getConversationsList = async (req, res) => {
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

        // Logic này có thể làm chậm API, cân nhắc bỏ nếu không quá cần thiết
        const conversationsWithLastMessage = await Promise.all(
            conversations.map(async (conv) => {
                const lastMessage = await Message.findOne({ conversationId: conv._id }).sort({ createdAt: -1 });
                return { ...conv.toObject(), lastMessage: lastMessage ? lastMessage.toObject() : null };
            })
        );
        
        res.json(conversationsWithLastMessage);
    } catch (err) {
        console.error('[CONVERSATION GET LIST] Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// API lấy chi tiết một cuộc trò chuyện
exports.getConversationById = async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id)
            .populate('sellerId', 'name')
            .populate('productId', 'name images price variantTable')
            .lean();
            
        if (!conversation) {
            return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện' });
        }

        const { productId, customerId, sellerId } = conversation;
        let relatedOrder = null;
        if (productId?._id && customerId && sellerId?._id) {
            relatedOrder = await Order.findOne({
                'items.productId': productId._id,
                'user': customerId,
                'consultationSellerId': sellerId._id,
                'isConsultationOrder': true,
                'status': { $in: ['Đang tư vấn', 'Chờ tư vấn', 'Chờ khách xác nhận'] }
            }).select('_id status').sort({ createdAt: -1 }).lean();
        }

        conversation.relatedOrder = relatedOrder;
        
        res.json(conversation);
    } catch (err) {
        console.error('[CONVERSATION GET DETAIL BY ID] Lỗi:', err.message, err.stack);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
