// server.js
const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
require('dotenv').config(); // Load biến môi trường

// Khởi tạo app Express
const app = express();

// Middleware quan trọng
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug biến môi trường
console.log('🔍 ENV Variables:', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  MONGODB_URI: process.env.MONGODB_URI ? '***' : 'MISSING!'
});

// Kết nối MongoDB với xử lý lỗi chi tiết
mongoose.connect(
  process.env.MONGODB_URI || 'mongodb://localhost:27017/taphoa', // Fallback local
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000 // Timeout sau 5s
  }
)
.then(() => console.log('✅ Đã kết nối MongoDB thành công'))
.catch(err => {
  console.error('❌ Lỗi kết nối MongoDB:', {
    message: err.message,
    code: err.code,
    codeName: err.codeName,
    reason: err.reason
  });
  process.exit(1); // Thoát ứng dụng nếu kết nối thất bại
});

// Routes
app.use('/api/auth', authRoutes);

// Xử lý lỗi tập trung
app.use((err, req, res, next) => {
  console.error('🔥 Error stack:', err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Khởi động server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy trên port ${PORT}`);
  console.log(`📡 Chế độ: ${process.env.NODE_ENV || 'development'}`);
});
