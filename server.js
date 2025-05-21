// server.js
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http'); // Thêm module http
const { Server } = require('socket.io'); // Thêm Socket.io
const authRoutes = require('./routes/authRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const cartRoutes = require('./routes/cartRoutes');
const User = require('./models/User'); // Thêm model User
const Order = require('./models/Order'); // Thêm model Order
require('dotenv').config();

const app = express();
const server = http.createServer(app); // Tạo HTTP server từ Express app
const io = new Server(server, { // Khởi tạo Socket.io
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware và config gốc giữ nguyên
app.use(cors());
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

// Socket.io Logic - Thêm phần này trước routes
io.on('connection', (socket) => {
  console.log(`🔌 New client connected: ${socket.id}`);

  // Xử lý cập nhật vị trí nhân viên
  socket.on('locationUpdate', async (data) => {
    try {
      await User.findByIdAndUpdate(data.userId, {
        'deliveryInfo.location.coordinates': [data.lng, data.lat]
      });
      
      // Broadcast vị trí mới cho các client liên quan
      socket.broadcast.emit('locationChanged', {
        userId: data.userId,
        coordinates: [data.lng, data.lat]
      });
    } catch (err) {
      console.error('Socket locationUpdate error:', err);
    }
  });

  // Theo dõi thay đổi trạng thái đơn hàng
  const changeStream = Order.watch();
  changeStream.on('change', (change) => {
    if (change.operationType === 'update') {
      const updatedFields = change.updateDescription.updatedFields;
      if (updatedFields.status) {
        io.emit('orderStatusUpdate', {
          orderId: change.documentKey._id,
          newStatus: updatedFields.status
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
    changeStream.close();
  });
});

// Các routes gốc giữ nguyên
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/cart', cartRoutes);

// 404 Handler và Error Handler giữ nguyên
app.use((req, res, next) => {
  res.status(404).json({
    status: 'error',
    message: 'Đường dẫn không tồn tại'
  });
});

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

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => { // Thay app.listen() bằng server.listen()
  console.log(`🚀 Server UP: http://localhost:${PORT}`);
  console.log(`📡 Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔄 Socket.io ready on port ${PORT}`);
});
