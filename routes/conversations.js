// routes/conversations.js
router.get('/conversations', async (req, res) => {
  const { customerId, adminId } = req.query;
  const query = {};
  if (customerId) query.customerId = customerId;
  if (adminId) query.adminId = adminId;
  const conversations = await Conversation.find(query).populate('productId').sort({ updatedAt: -1 });
  res.json(conversations);
});

router.post('/conversations', async (req, res) => {
  const { productId, customerId, adminId } = req.body;
  const conversation = new Conversation({ productId, customerId, adminId, createdAt: new Date(), updatedAt: new Date() });
  await conversation.save();
  res.json({ _id: conversation._id });
});

router.get('/messages/:conversationId', async (req, res) => {
  const messages = await Message.find({ conversationId: req.params.conversationId }).sort({ createdAt: 1 });
  res.json(messages);
});

router.post('/messages', async (req, res) => {
  const { conversationId, senderId, content } = req.body;
  const message = new Message({ conversationId, senderId, content, createdAt: new Date() });
  await message.save();
  await Conversation.updateOne({ _id: conversationId }, { updatedAt: new Date() });
  res.json({ _id: message._id, content, createdAt: message.createdAt });
});
