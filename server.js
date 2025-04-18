// server.js
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const productRoutes  = require('./routes/productRoutes');
require('dotenv').config();

// 1. Khởi tạo ứng dụng
const app = express();

app.use(cors()); 
// 2. Middleware cốt lõi
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Kiểm tra biến môi trường (Critical check)
console.log('🔧 Environment Check:', {
  NODE_ENV: process.env.NODE_ENV || 'undefined',
  PORT: process.env.PORT || 'undefined',
  MONGODB_URI: process.env.MONGODB_URI ? '***' : 'MISSING - KILLING PROCESS'
});

// 4. Kết nối MongoDB Atlas
const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('[FATAL] MONGODB_URI not found in .env');
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 3000,
      socketTimeoutMS: 20000
    });
    console.log('✅ MongoDB Atlas Connected');
  } catch (err) {
    console.error('❌ DATABASE CONNECTION FAILED:', {
      error: err.name,
      message: err.message,
      stack: err.stack
    });
    process.exit(1); // Force exit
  }
};

// 5. Khởi động kết nối DB
connectDB();

// 6. Route chính
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/products',   productRoutes);
// 7. Xử lý lỗi toàn cục
app.use((err, req, res, next) => {
  console.error('💥 ERROR:', {
    path: req.path,
    method: req.method,
    error: err.stack
  });
  res.status(500).json({ 
    status: 'error',
    message: 'Internal Server Error' 
  });
});

// 8. Khởi động server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server UP: http://localhost:${PORT}`);
  console.log(`📡 Mode: ${process.env.NODE_ENV || 'development'}`);
});
