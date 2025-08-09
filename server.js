const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const cartRoutes = require('./routes/cartRoutes');
const shipperRoutes = require('./routes/shipperRoutes');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/userRoutes');
const shippingRoutes = require('./routes/shippingRoutes');
const voucherRoutes = require('./routes/voucherRoutes');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
require('dotenv').config();
require('./config/firebase');
const {initShippingFees} = require('./utils/initData');
const sellerRoutes = require('./routes/sellerRoutes');
const payoutRoutes = require('./routes/payoutRoutes');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Type']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

console.log('🔧 Environment Check:', {
  NODE_ENV: process.env.NODE_ENV || 'undefined',
  PORT: process.env.PORT || 'undefined',
  MONGODB_URI: process.env.MONGODB_URI ? '***' : 'MISSING - KILLING PROCESS'
});

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
    await initShippingFees();
  } catch (err) {
    console.error('❌ DATABASE CONNECTION FAILED:', {
      error: err.name,
      message: err.message,
      stack: err.stack
    });
    process.exit(1);
  }
};

connectDB();

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/shippers', shipperRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/shipping', shippingRoutes);
app.use('/api/v1/vouchers', voucherRoutes);
app.use('/api/v1/conversations', conversationRoutes);
app.use('/api/v1/messages', messageRoutes);
app.use('/api/v1/sellers', sellerRoutes);
app.use('/api/v1/payouts', payoutRoutes); 

// 404 Handler
app.use((req, res, next) => {
  res.status(404).json({
    status: 'error',
    message: 'Đường dẫn không tồn tại'
  });
});

// Global Error Handler
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

// --- PHẦN KHỞI ĐỘNG SERVER ĐÃ ĐƯỢC SỬA LẠI ---

// 1. Lấy PORT từ biến môi trường (do Railway cung cấp).
//    Nếu không có (khi chạy local), sẽ dùng port 10000.
const PORT = process.env.PORT || 10000;

// 2. Định nghĩa HOST. 
//    Trên server production (như Railway), nó phải là '0.0.0.0' để chấp nhận kết nối từ bên ngoài.
//    Khi chạy local, nó sẽ là 'localhost'.
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';

// 3. Khởi động server với PORT và HOST đã được định nghĩa
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server UP: Listening on http://${HOST}:${PORT}`);
  console.log(`📡 Mode: ${process.env.NODE_ENV || 'development'}`);
});
