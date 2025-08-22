// models/Message.js
const mongoose = require('mongoose');
const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  
  // --- THÊM CÁC TRƯỜNG MỚI ---
  messageType: {
    type: String,
    enum: ['text', 'system', 'quote_summary', 'image'], // 'text' là tin nhắn thường
    default: 'text'
  },
  // Dữ liệu bổ sung cho các tin nhắn đặc biệt
  data: {
    type: Object, 
    default: {}
  },
  // --- KẾT THÚC THÊM ---

  isRead: { type: Boolean, default: false },
}, {
  timestamps: true
});

module.exports = mongoose.model('Message', messageSchema);
