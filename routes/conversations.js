// routes/conversations.js
const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const Product = require('../models/Product');
const { verifyToken } = require('../middlewares/authMiddleware');
const DEFAULT_SELLER_ID = '67f6ab0b9c31a3c6943aed6e';

router.get('/', verifyToken, async (req, res) => {
  try {
    const { customerId } = req.query;
    console.log('[Conversations] Fetching for customerId:', customerId);
    if (!customerId) {
      return res.status(400).json({ error: 'customerId required' });
    }
    if (customerId !== req.user._id.toString()) {
      console.log('[Conversations] customerId mismatch:', { customerId, userId: req.user._id });
      return res.status(403).json({ error: 'Unauthorized access' });
    }
    const conversations = await Conversation.find({ customerId })
      .populate('productId', 'name images price')
      .populate('customerId', 'name')
      .populate('sellerId', 'name');
    console.log('[Conversations] Found:', conversations.length);
    res.json(conversations);
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

    // Gán sellerId từ createdBy hoặc mặc định
    const sellerId = product.createdBy || DEFAULT_SELLER_ID;
    console.log('[conversations] Assigned sellerId:', sellerId);

    const conversation = new Conversation({
      productId,
      customerId,
      sellerId,
    });

    await conversation.save();
    console.log('[conversations] Conversation created:', conversation._id);

    // Log thông báo tới seller
    console.log(`[conversations] Notify seller ${sellerId} of new message in ${conversation._id}`);

    res.json({ status: 'success', data: conversation });
  } catch (err) {
    console.error('[conversations] Error:', err.message);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

module.exports = router;
