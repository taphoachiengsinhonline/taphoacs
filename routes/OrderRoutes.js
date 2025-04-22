const express = require('express');
 const router = express.Router();
 const Order = require('../models/Order');
 const { verifyToken, isAdminMiddleware } = require('../middleware/authMiddleware'); // middleware đúng
 const { verifyToken, isAdminMiddleware } = require('../middleware/authMiddleware');
 const sendPushNotification = require('../utils/sendPushNotification'); // thêm dòng này
 const User = require('../models/User'); // để lấy token admin
 
 // Tạo đơn hàng mới (người dùng đã đăng nhập)
 router.post('/', verifyToken, async (req, res) => {
 @@ -23,8 +25,21 @@ router.post('/', verifyToken, async (req, res) => {
     });
 
     const savedOrder = await newOrder.save();
 
     // 🔔 Gửi thông báo push đến Admin (nếu có token)
     const admins = await User.find({ isAdmin: true, expoPushToken: { $exists: true, $ne: null } });
 
     for (const admin of admins) {
       await sendPushNotification(
         admin.expoPushToken,
         '🛒 Có đơn hàng mới!',
         `Người dùng ${req.user.name || 'khách'} vừa đặt hàng. Tổng: ${total.toLocaleString()}đ`
       );
     }
 
     res.status(201).json(savedOrder);
   } catch (err) {
     console.error('Lỗi tạo đơn hàng:', err);
     res.status(500).json({ message: 'Lỗi tạo đơn hàng', error: err.message });
   }
 });
 @@ -39,10 +54,12 @@ router.get('/my-orders', verifyToken, async (req, res) => {
   }
 });
 
 // Lấy tất cả đơn hàng (chỉ admin mới xem được)
 // Lấy tất cả đơn hàng (chỉ admin)
 router.get('/', verifyToken, isAdminMiddleware, async (req, res) => {
   try {
     const orders = await Order.find().populate('user', 'name email').sort({ createdAt: -1 });
     const orders = await Order.find()
       .populate('user', 'name email')
       .sort({ createdAt: -1 });
     res.json(orders);
   } catch (err) {
     res.status(500).json({ message: 'Lỗi lấy danh sách đơn hàng', error: err.message });
