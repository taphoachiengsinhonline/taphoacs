// models/Message.js
const mongoose = require('mongoose');
const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  isRead: { type: Boolean, default: false },
}, {
  // THÊM: Sử dụng timestamps để Mongoose tự quản lý createdAt
  timestamps: true
});

// XÓA: Không cần định nghĩa createdAt thủ công
// createdAt: { type: Date, default: Date.now }

module.exports = mongoose.model('Message', messageSchema);
