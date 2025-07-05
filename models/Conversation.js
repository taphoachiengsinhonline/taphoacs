// models/Conversation.js
const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
  productId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Product', 
    required: true 
  },
  customerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  sellerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  },
  unreadBySeller: { type: Number, default: 0 },
  unreadByCustomer: { type: Number, default: 0 },
}, {
  // THÊM: Sử dụng timestamps để Mongoose tự quản lý createdAt và updatedAt
  timestamps: true 
});

// XÓA: Không cần định nghĩa createdAt và updatedAt thủ công nữa
// createdAt: { type: Date, default: Date.now },
// updatedAt: { type: Date, default: Date.now },

module.exports = mongoose.model('Conversation', ConversationSchema);
