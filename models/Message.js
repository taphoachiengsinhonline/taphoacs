// models/Message.js
// PHIÊN BẢN HOÀN CHỈNH

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Conversation', 
    required: true,
    index: true // Thêm index để query nhanh hơn
  },
  senderId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  content: { 
    type: String, 
    required: true,
    trim: true
  },
  
  messageType: {
    type: String,
    enum: ['text', 'system', 'quote_summary', 'image'],
    default: 'text'
  },
  
  // Dữ liệu bổ sung cho các loại tin nhắn đặc biệt
  data: {
    quoteTitle: String,
    items: Array,
    total: Number,
    shippingFee: Number,
    itemsTotal: Number,
    status: String,
    orderId: String,
    caption: String, // Chú thích cho ảnh
  },
  
  isRead: { 
    type: Boolean, 
    default: false 
  },
}, {
  timestamps: true // Tự động thêm createdAt và updatedAt
});

module.exports = mongoose.model('Message', messageSchema);
