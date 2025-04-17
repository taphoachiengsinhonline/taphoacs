// server.js
const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes'); // Đảm bảo đường dẫn đúng
require('dotenv').config();

const app = express();

// Middleware quan trọng cần thêm
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

// Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Đã kết nối MongoDB'))
.catch(err => console.error('❌ Lỗi MongoDB:', err));

// Routes
app.use('/auth', authRoutes); // Đảm bảo authRoutes là router hợp lệ

// Xử lý lỗi tập trung
app.use((err, req, res, next) => {
  console.error('🔥 Error stack:', err.stack);
  res.status(500).json({ error: 'Lỗi server' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server chạy trên port ${PORT}`));
