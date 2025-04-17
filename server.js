// server.js
const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug environment variables
console.log('🔍 ENV Variables:', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  MONGODB_URI: process.env.MONGODB_URI ? '***' : 'MISSING - FATAL ERROR!'
});

// Kết nối MongoDB (đã remove deprecated options)
const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is required in environment variables');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Đã kết nối MongoDB thành công');
  } catch (err) {
    console.error('❌ Lỗi MongoDB nghiêm trọng:', {
      error: err.name,
      message: err.message,
      stack: err.stack
    });
    process.exit(1); // Thoát ứng dụng ngay lập tức
  }
};

connectDB();

// Routes
app.use('/api/auth', authRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error('🔥 Error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server ready on port ${PORT}`);
});
