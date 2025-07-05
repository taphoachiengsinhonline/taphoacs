// routes/conversations.js
const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const Product = require('../models/Product');
const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/', verifyToken, async (req, res) => {
  try {
    const { customerId, sellerId } = req.query;
    console.log('[Conversations] Fetching for customerId:', customerId, 'sellerId:', sellerId);
    let query = {};
    
    if (customerId) {
      query.customerId = customerId;
      if (customerId !== req.user._id.toString() && !req.user.isAdmin) {
        return res.status(403).json({ error: 'Unauthorized access' });
      }
    } 
    if (sellerId) {
      query.sellerId = sellerId;
    } else if (req.user.isAdmin) {
      query.sellerId = req.user._id;
    }
    
    // Lấy các conversation và group by seller
    const conversations = await Conversation.find(query)
      .populate('productId', 'name images price')
      .populate('customerId', 'name')
      .populate('sellerId', 'name avatar')
      .sort({ updatedAt: -1 });

    // Nhóm các conversation theo seller
    const sellersMap = new Map();
    conversations.forEach(conv => {
      const sellerId = conv.sellerId._id.toString();
      if (!sellersMap.has(sellerId)) {
        sellersMap.set(sellerId, {
          seller: conv.sellerId,
          lastMessage: conv.updatedAt,
          unreadCount: 0,
          conversations: []
        });
      }
      sellersMap.get(sellerId).conversations.push(conv);
      sellersMap.get(sellerId).lastMessage = Math.max(sellersMap.get(sellerId).lastMessage, conv.updatedAt);
    });

    // Chuyển thành mảng seller
    const sellers = Array.from(sellersMap.values()).map(sellerData => ({
      _id: sellerData.seller._id,
      name: sellerData.seller.name,
      avatar: sellerData.seller.avatar,
      lastMessage: sellerData.lastMessage,
      unreadCount: sellerData.unreadCount,
      // Thêm conversationId vào previewProduct
      previewProduct: sellerData.conversations[0] ? {
        ...sellerData.conversations[0].productId.toObject(),
        conversationId: sellerData.conversations[0]._id
      } : null
    }));

    console.log('[Conversations] Found sellers:', sellers.length);
    res.json(sellers);
  } catch (err) {
    console.error('[Conversations] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// <<< THAY THẾ TOÀN BỘ ROUTE POST NÀY >>>
router.post('/', verifyToken, async (req, res) => {
    try {
        const { productId, sellerId } = req.body;
        const customerId = req.user._id;

        console.log(`[CONVERSATION] Yêu cầu tạo/tìm chat:`, { productId, sellerId, customerId });

        if (!productId || !sellerId) {
            return res.status(400).json({ message: 'Thiếu thông tin sản phẩm hoặc người bán.' });
        }

        // Tìm một cuộc trò chuyện đã tồn tại với bộ 3: customer, seller, product
        let conversation = await Conversation.findOne({
            productId,
            customerId,
            sellerId
        });

        if (conversation) {
            console.log(`[CONVERSATION] Đã tìm thấy cuộc trò chuyện cũ: ${conversation._id}`);
            // Nếu đã có, trả về luôn
            return res.status(200).json(conversation);
        }

        // Nếu chưa có, tạo mới
        console.log(`[CONVERSATION] Không tìm thấy, tạo cuộc trò chuyện mới...`);
        conversation = new Conversation({
            productId,
            customerId,
            sellerId,
        });

        await conversation.save();
        console.log(`[CONVERSATION] Đã tạo thành công: ${conversation._id}`);

        res.status(201).json(conversation);

    } catch (err) {
        console.error('[CONVERSATION] Lỗi khi tạo/tìm cuộc trò chuyện:', err.message);
        res.status(500).json({ message: 'Lỗi server' });
    }
});


// Thêm endpoint mới
router.get('/customer-seller', verifyToken, async (req, res) => {
  try {
    const { customerId, sellerId } = req.query;
    if (!customerId || !sellerId) {
      return res.status(400).json({ error: 'Missing customerId or sellerId' });
    }

    const conversations = await Conversation.find({ 
      customerId, 
      sellerId 
    })
      .populate('productId', 'name images price')
      .sort({ updatedAt: -1 });

    res.json(conversations);
  } catch (err) {
    console.error('[Conversations] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


router.get('/:id', verifyToken, async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id)
      .populate('productId', 'name images price')
      .populate('sellerId', 'name');
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    res.json(conversation);
  } catch (err) {
    console.error('[Conversation] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});



module.exports = router;
