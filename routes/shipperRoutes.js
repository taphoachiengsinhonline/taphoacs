const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware'); // Thêm isAdmin
const Order = require('../models/Order');
const User = require('../models/User'); // Thêm model User
const bcrypt = require('bcrypt'); // Thêm bcrypt để mã hóa mật khẩu

// Route POST để tạo shipper mới
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { email, password, name, phone, vehicleType, licensePlate } = req.body;

    // Kiểm tra xem email đã tồn tại chưa
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email đã tồn tại' });
    }

    // Tạo shipper mới
    const shipper = new User({
      email,
      password,
      name,
      phone,
      role: 'shipper', // Gán vai trò là shipper
      shipperProfile: {
        vehicleType,
        licensePlate
      }
    });

    await shipper.save();

    // Trả về thông tin shipper vừa tạo
    res.status(201).json({
      _id: shipper._id,
      email: shipper.email,
      role: shipper.role,
      shipperProfile: shipper.shipperProfile
    });
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});

// Các route hiện có
router.get('/assigned-orders', verifyToken, async (req, res) => {
  try {
    const orders = await Order.find({ 
      shipper: req.user._id,
      status: { $in: ['Đang giao', 'Đã nhận'] }
    }).sort('-createdAt');
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

router.put('/orders/:id/status', verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, shipper: req.user._id },
      { status },
      { new: true }
    );
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    sendPushNotificationToCustomer(order.user, `Trạng thái đơn hàng: ${status}`);
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});


// GET /api/v1/shippers/stats
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments({ shipper: req.user._id });

    const orders = await Order.find({
      shipper: req.user._id,
      status: 'Hoàn thành' // chỉ tính doanh thu từ đơn đã giao xong
    });

    const totalRevenue = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    res.json({ totalOrders, totalRevenue });
  } catch (error) {
    res.status(500).json({ message: 'Lỗi khi lấy thống kê: ' + error.message });
  }
});



module.exports = router;
