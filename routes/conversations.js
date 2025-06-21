// routes/conversations.js
const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const Product = require('../models/Product');
const { verifyToken } = require('../middlewares/authMiddleware');
const DEFAULT_SELLER_ID = '67f6ab0b9c31a3c6943aed6e';

router.get('/', verifyToken, async (req, res) => {
  try {
    const { customerId, sellerId } = req.query;
    console.log('[Conversations] Fetching for customerId:', customerId, 'sellerId:', sellerId);
    let query = {};
    
    // Lấy danh sách seller mà customer đã chat
    if (customerId) {
      query.customerId = customerId;
      if (customerId !== req.user._id.toString() && !req.user.isAdmin) {
        return res.status(403).json({ error: 'Unauthorized access' });
      }
    } 
    // Lấy danh sách conversation cho seller
    else if (sellerId) {
      query.sellerId = sellerId;
    } 
    // Admin lấy conversations của mình
    else if (req.user.isAdmin) {
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
      // Lấy sản phẩm đầu tiên làm preview
      previewProduct: sellerData.conversations[0]?.productId
    }));

    console.log('[Conversations] Found sellers:', sellers.length);
    res.json(sellers);
  } catch (err) {
    console.error('[Conversations] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


router.post('/', async (req, res) => {
  const { productId, customerId } = req.body;
  console.log('[conversations] Creating conversation:', { productId, customerId });

  try {
    const product = await Product.findById(productId).select('createdBy');
    if (!product) {
      console.log('[conversations] Product not found:', productId);
      return res.status(400).json({ status: 'error', message: 'Product not found' });
    }

    const sellerId = product.createdBy || DEFAULT_SELLER_ID;
    console.log('[conversations] Assigned sellerId:', sellerId);

    const conversation = new Conversation({
      productId,
      customerId,
      sellerId,
    });

    await conversation.save();
    console.log('[conversations] Conversation created:', conversation._id);

    res.json({ status: 'success', data: conversation });
  } catch (err) {
    console.error('[conversations] Error:', err.message);
    res.status(500).json({ status: 'error', message: 'Server error' });
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




module.exports = router;
