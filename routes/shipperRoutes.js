// routes/shipperRoutes.js

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin, protect, restrictTo } = require('../middlewares/authMiddleware');
const shipperController = require('../controllers/shipperController');
const orderController = require('../controllers/orderController'); // Cần import để dùng
const User = require('../models/User'); // Cần import
const bcrypt = require('bcrypt'); // Cần import
const Notification = require('../models/Notification'); // Cần import
const PendingDelivery = require('../models/PendingDelivery'); // Cần import



// Route POST để tạo shipper mới (do admin) - Chức năng này nên nằm trong adminRoutes.js, nhưng để tạm ở đây theo code cũ của bạn
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { email, password, name, phone, vehicleType, licensePlate } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email đã tồn tại' });
    }

    const shipper = new User({
      email,
      password,
      name,
      phone,
      role: 'shipper',
      shipperProfile: {
        vehicleType,
        licensePlate
      }
    });

    await shipper.save();

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

// Route để shipper cập nhật vị trí
router.post('/update-location', verifyToken, shipperController.updateLocation);

// Route để shipper lấy danh sách đơn hàng đã gán cho mình (có filter và phân trang)
router.get('/assigned-orders', verifyToken, shipperController.getAssignedOrders);

// Route để shipper cập nhật trạng thái đơn hàng (ví dụ: chuyển từ Đang xử lý -> Đang giao)
router.put('/orders/:id/status', verifyToken, orderController.updateOrderStatusByShipper);

// Route để shipper chấp nhận một đơn hàng mới
router.post('/orders/:id/accept', verifyToken, orderController.acceptOrder);

// Route để shipper thêm phụ phí vào đơn hàng
router.post('/orders/:id/add-surcharge', verifyToken, shipperController.addSurcharge);

// Route để shipper lấy thống kê tổng quan (Tổng đơn, Hoàn thành, Doanh thu)
router.get('/stats', verifyToken, shipperController.getShipperStats);

// Route để shipper lấy số lượng đơn hàng theo từng trạng thái
router.get('/order-counts', verifyToken, shipperController.getOrderCounts);

// Route để shipper lấy danh sách thông báo
router.get('/notifications', verifyToken, shipperController.getShipperNotifications);

// Route để shipper cập nhật FCM token
router.post('/update-fcm-token', verifyToken, shipperController.updateFcmToken);

// Route để shipper đổi mật khẩu
router.post('/change-password', verifyToken, shipperController.changePassword);
router.post('/remittance/confirm', shipperController.confirmRemittance);
// Route để shipper xem báo cáo doanh thu theo khoảng thời gian tùy chỉnh hoặc theo kỳ
router.get('/revenue', verifyToken, shipperController.getRevenueReport);


module.exports = router;
