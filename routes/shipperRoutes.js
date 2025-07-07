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

router.use(protect); // Đảm bảo người dùng đã đăng nhập và có req.user
router.use(restrictTo('shipper')); // Đảm bảo người dùng có vai trò là 'shipper'


// --- CÁC ROUTE CHỨC NĂNG CỦA SHIPPER ---

// Route để shipper cập nhật vị trí
router.post('/update-location', shipperController.updateLocation);

// Route để shipper lấy danh sách đơn hàng đã gán cho mình (có filter và phân trang)
router.get('/assigned-orders', shipperController.getAssignedOrders);

// Route để shipper cập nhật trạng thái đơn hàng (ví dụ: chuyển từ Đang xử lý -> Đang giao)
// Chuyển route này vào orderController hoặc giữ ở đây nhưng đảm bảo logic đúng
// Tạm thời để ở orderController như code cũ của bạn
router.put('/orders/:id/status', orderController.updateOrderStatusByShipper);

// Route để shipper chấp nhận một đơn hàng mới
// Tạm thời để ở orderController như code cũ của bạn
router.post('/orders/:id/accept', orderController.acceptOrder);

// Route để shipper thêm phụ phí vào đơn hàng
router.post('/orders/:id/add-surcharge', shipperController.addSurcharge);

// Route để shipper lấy thống kê tổng quan (dùng cho một màn hình khác, không phải HomeScreen)
router.get('/stats', shipperController.getShipperStats);

// Route để shipper lấy số lượng đơn hàng theo từng trạng thái (dùng cho OrderListScreen)
router.get('/order-counts', shipperController.getOrderCounts);

// Route để shipper lấy danh sách thông báo
router.get('/notifications', shipperController.getShipperNotifications);

// Route để shipper cập nhật FCM token
router.post('/update-fcm-token', shipperController.updateFcmToken);

// Route để shipper đổi mật khẩu
router.post('/change-password', shipperController.changePassword);

// --- CÁC ROUTE BÁO CÁO VÀ TÀI CHÍNH ---

// Route cho HomeScreen để lấy dữ liệu nhanh trong ngày
// Đã đổi tên hàm trong controller để rõ ràng hơn, bạn cần đảm bảo controller có hàm này
router.get('/dashboard-summary', shipperController.getDashboardSummary); 

// Route cho RevenueReportScreen để lấy báo cáo chi tiết theo tháng
router.get('/monthly-report', shipperController.getMonthlyFinancialReport);

// Route để shipper xác nhận đã nộp tiền
router.post('/remittance/confirm', shipperController.confirmRemittance);


module.exports = router;
