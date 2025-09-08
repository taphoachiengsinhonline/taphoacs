// controllers/conversationController.js

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Order = require('../models/Order'); // Import Order model
const User = require('../models/User'); // Import User model
const mongoose = require('mongoose');
const { sendMessage } = require('../services/messageService');

// API để Khách hàng hoặc Seller tạo/tìm cuộc trò chuyện
exports.findOrCreateConversation = async (req, res) => {
  try {
    const { productId, sellerId } = req.body;
    const customerId = req.user._id;

    if (!productId || !sellerId) {
      return res.status(400).json({ message: 'Thiếu thông tin sản phẩm hoặc người bán.' });
    }
    
    let conversation = await Conversation.findOne({ productId, customerId, sellerId });
    let isNewConversation = false;

    if (!conversation) {
      isNewConversation = true;
      conversation = new Conversation({ productId, customerId, sellerId });
    }
    
    conversation.updatedAt = new Date();
    await conversation.save();
    
    // Cập nhật lastActive cho cả seller và customer
    await User.findById(sellerId).updateLastActive();
    await User.findById(customerId).updateLastActive();
    
    if (isNewConversation) {
      const seller = await User.findById(sellerId).select('sellerProfile.autoResponseMessage');
      const autoMessageContent = seller?.sellerProfile?.autoResponseMessage;

      if (autoMessageContent && autoMessageContent.trim() !== '') {
        await sendMessage({
          conversationId: conversation._id,
          senderId: sellerId,
          content: autoMessageContent,
          messageType: 'text'
        });
        console.log(`Đã gửi tin nhắn tự động (qua service) cho conversation: ${conversation._id}`);
      }
    }
    
    res.status(isNewConversation ? 201 : 200).json(conversation);
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

        let matchStage, otherUserField, unreadField;

        if (userRole === 'seller') {
            matchStage = { sellerId: new mongoose.Types.ObjectId(userId) };
            otherUserField = '$customerId';
            unreadField = '$unreadBySeller';
        } else { // customer
            matchStage = { customerId: new mongoose.Types.ObjectId(userId) };
            otherUserField = '$sellerId';
            unreadField = '$unreadByCustomer';
        }

        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

        const pipeline = [
            { $match: matchStage },
            { $sort: { updatedAt: -1 } },
            { $group: { _id: otherUserField, totalUnread: { $sum: unreadField }, lastConversation: { $first: '$$ROOT' } } },
            { $sort: { 'lastConversation.updatedAt': -1 } },
            
            // --- BẮT ĐẦU SỬA ---
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    // Sử dụng pipeline con để định hình lại dữ liệu user trả về
                    pipeline: [
                        {
                            $project: {
                                name: 1,
                                avatar: 1,
                                'shopProfile.avatar': 1,
                                'shopProfile.lastActive': 1, // << LẤY TRƯỜNG lastActive
                                isOnline: { // << TÍNH TOÁN isOnline NGAY TẠI ĐÂY
                                    $cond: {
                                        if: { $gt: [ { $ifNull: [ "$shopProfile.lastActive", null ] }, twoMinutesAgo ] },
                                        then: true,
                                        else: false
                                    }
                                }
                            }
                        }
                    ],
                    as: 'otherUser'
                }
            },
            // --- KẾT THÚC SỬA ---
            { $unwind: { path: '$otherUser', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'messages', localField: 'lastConversation._id', foreignField: 'conversationId', as: 'messages' } },
            { $addFields: { lastMessageObject: { $last: '$messages' } } },
            
            {
                $project: {
                    _id: 1,
                    totalUnread: 1,
                    lastUpdatedAt: '$lastConversation.updatedAt',
                    'otherUser._id': 1,
                    'otherUser.name': 1,
                    'otherUser.avatar': 1,
                    'otherUser.shopProfile': 1,
                    'otherUser.isOnline': {
                       $cond: {
                          if: { $gt: [ { $ifNull: [ "$otherUser.shopProfile.lastActive", null ] }, twoMinutesAgo ] },
                          then: true,
                          else: false
                       }
                    },
                    lastMessageContent: {
                        $let: {
                            vars: { msg: "$lastMessageObject" },
                            in: {
                                $cond: {
                                    if: { $eq: ["$$msg.messageType", "quote_summary"] },
                                    then: {
                                        $cond: {
                                            if: { $eq: ["$$msg.senderId", new mongoose.Types.ObjectId(userId)] },
                                            then: "Bạn đã gửi một báo giá",
                                            else: "Bạn đã nhận được một báo giá"
                                        }
                                    },
                                    else: {
                                        $cond: {
                                            if: { $eq: ["$$msg.messageType", "image"] },
                                            then: {
                                                $cond: {
                                                    if: { $eq: ["$$msg.senderId", new mongoose.Types.ObjectId(userId)] },
                                                    then: "Bạn đã gửi một hình ảnh",
                                                    else: "Bạn đã nhận được một hình ảnh"
                                                }
                                            },
                                            else: { $ifNull: ["$$msg.content", "Bắt đầu trò chuyện"] }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        ];

        const groupedConversations = await Conversation.aggregate(pipeline);
        
        console.log("--- DEBUG: Dữ liệu getGroupedConversations TRƯỚỚC KHI GỬI VỀ CLIENT ---");
        if (groupedConversations.length > 0) {
            console.log("Ví dụ một bản ghi (otherUser object):");
            console.log(JSON.stringify(groupedConversations[0].otherUser, null, 2));
        } else {
            console.log("Không có cuộc trò chuyện nào được tìm thấy.");
        }
        console.log("--------------------------------------------------------------------");

        res.json(groupedConversations);

    } catch (err) {
        console.error('[CONVERSATION GROUPED GET] LỖI CHI TIẾT:', err);
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
            .populate('customerId', 'name avatar')
            // Populate cả object shopProfile để có lastActive
            .populate('sellerId', 'name avatar shopProfile') 
            .populate('productId', 'name images price variantTable')
            .sort({ updatedAt: -1 })
            .lean({ virtuals: true }); // Thêm virtuals: true
        // --- KẾT THÚC SỬA ---
        res.json(conversations);
        
    } catch (err) {
        console.error('[CONVERSATION GET LIST] Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
  
// API lấy chi tiết một cuộc trò chuyện
exports.getConversationById = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id)
      .populate('sellerId', 'name avatar shopProfile.avatar shopProfile.lastActive')
      .populate('customerId', 'name avatar')
      .populate('productId', 'name images price variantTable')
      .lean();

    if (!conversation) {
      return res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện' });
    }

    const productIdValue = conversation.productId?._id;
    const customerIdValue = conversation.customerId;
    const sellerIdValue = conversation.sellerId?._id;
    
    let relatedOrder = null;
    if (productIdValue && customerIdValue && sellerIdValue) {
      const searchQuery = {
        'items.productId': productIdValue,
        'user': customerIdValue,
        'consultationSellerId': sellerIdValue,
        'isConsultationOrder': true,
      };

      relatedOrder = await Order.findOne(searchQuery)
        .select('_id status items customTitle total sellerNotes')
        .sort({ createdAt: -1 })
        .lean();
    }

    conversation.relatedOrder = relatedOrder;
    res.json(conversation);
  } catch (err) {
    console.error('[CONVERSATION GET DETAIL BY ID] Lỗi:', err.message, err.stack);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
