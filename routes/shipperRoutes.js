// routes/shipperRoutes.js
const PendingDelivery = require('../models/PendingDelivery');
const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const Order = require('../models/Order');
const User = require('../models/User');
const bcrypt = require('bcrypt');
const { sendPushNotificationToCustomer } = require('../utils/sendPushNotification');
const shipperController = require('../controllers/shipperController');
// Route POST để tạo shipper mới

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

// FIX: Sửa hoàn toàn endpoint update location
router.post('/update-location', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    // 1. Lấy thời điểm hiện tại (UTC), rồi cộng thêm 7 giờ
    const nowUTC = Date.now();                       // miliseconds kể từ 1970 tại UTC
    const sevenHours = 7 * 60 * 60 * 1000;           // 7 giờ = 7*60*60*1000 ms
    const nowVNDateObj = new Date(nowUTC + sevenHours);

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          location: {
            type: 'Point',
            coordinates: [longitude, latitude]
          },
          locationUpdatedAt: nowVNDateObj,  // ← giờ Việt Nam
          isAvailable: true
        }
      },
      {
        new: true,
        runValidators: false,
        context: 'query'
      }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }

    // 2. Trả về thông tin cùng chuỗi ISO của giờ đã cộng +7
    res.json({ 
      message: 'Cập nhật vị trí thành công',
      location: updatedUser.location,
      // Ví dụ: "2025-06-01T03:00:00.000Z" (tương đương 10:00:00 GMT+7)
      updatedAt: updatedUser.locationUpdatedAt.toISOString()
    });
  } catch (error) {
    console.error('Lỗi cập nhật vị trí:', error);
    res.status(500).json({ message: 'Lỗi cập nhật vị trí: ' + error.message });
  }
});


// Các route khác giữ nguyên
// GET danh sách đơn đã gán, phân trang, filter status & khoảng thời gian
// routes/shipperRoutes.js

router.get('/assigned-orders', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, status, from, to } = req.query;
    const filter = { shipper: req.user._id };

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (from && to) {
      // Lọc theo thời điểm shipper nhận đơn (acceptedAt), không phải createdAt
      filter['timestamps.acceptedAt'] = {
        $gte: new Date(from),
        $lte: new Date(to)
      };
    }

    const result = await Order.paginate(filter, {
      page:  parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort:  { 'timestamps.acceptedAt': -1 } // ưu tiên vừa nhận gần nhất
    });

    return res.json({
      orders: result.docs.map(d => ({ ...d.toObject(), timestamps: d.timestamps })),
      totalPages: result.totalPages,
      currentPage: result.page
    });
  } catch (error) {
    console.error('[assigned-orders] error:', error);
    return res.status(500).json({ message: 'Lỗi server khi lấy đơn hàng đã gán' });
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
    
    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }
    
    if (typeof sendPushNotificationToCustomer === 'function') {
      sendPushNotificationToCustomer(order.user, `Trạng thái đơn hàng: ${status}`);
    }
    
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});

// routes/shippers.js (hoặc tên file tương ứng)
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments({ shipper: req.user._id });
    const completedOrdersList = await Order.find({
      shipper: req.user._id,
      status: 'Đã giao'
    });
    const completedOrdersCount = completedOrdersList.length;
    const totalRevenue = completedOrdersList.reduce(
  (sum, order) => sum + (order.total || 0), 0
);

    console.log('[Backend] Stats:', { totalOrders, completedOrdersCount, totalRevenue }); // Debug
    res.json({
      totalOrders,
      completedOrders: completedOrdersCount,
      totalRevenue
    });
  } catch (error) {
    console.error('Lỗi khi lấy thống kê:', error);
    res.status(500).json({ message: 'Lỗi khi lấy thống kê: ' + error.message });
  }
});


const Notification = require('../models/Notification');

router.get('/notifications', verifyToken, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort('-createdAt')
      .limit(20);
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi khi lấy thông báo: ' + error.message });
  }
});

// Endpoint để shipper cập nhật/đăng ký fcmToken
router.post('/update-fcm-token', verifyToken, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ message: 'Thiếu fcmToken' });
    }
    // Tìm và cập nhật user (shipper) đang login
    const updatedShipper = await User.findByIdAndUpdate(
      req.user._id,
      { fcmToken },
      { new: true }
    );
    res.json({
      message: 'Cập nhật FCM token thành công',
      fcmToken: updatedShipper.fcmToken
    });
  } catch (error) {
    console.error('Lỗi update fcmToken:', error);
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});


router.post('/orders/:id/accept', verifyToken, async (req, res) => {
  try {
    // Kiểm tra xem shipper có được phép nhận đơn này không
    const pending = await PendingDelivery.findOne({ orderId: req.params.id });
    if (!pending || !pending.triedShippers.includes(req.user._id)) {
      return res.status(403).json({ message: 'Bạn không được phép nhận đơn hàng này' });
    }

    // Tìm đơn hàng ở trạng thái "Chờ xác nhận"
    const order = await Order.findOne({ _id: req.params.id, status: 'Chờ xác nhận' });
    if (!order) {
      return res.status(404).json({ message: 'Đơn hàng không tồn tại hoặc không ở trạng thái chờ xác nhận' });
    }

    // Gán shipper và cập nhật trạng thái
    order.shipper = req.user._id;
    order.status = 'Đang xử lý'; // Hoặc 'Đang lấy hàng' tùy theo luồng
    await order.save();

    // Xóa khỏi PendingDelivery sau khi nhận
    await PendingDelivery.deleteOne({ orderId: order._id });

    res.json({ message: 'Nhận đơn thành công', order });
  } catch (error) {
    console.error('Lỗi khi nhận đơn:', error);
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});

// Đổi mật khẩu
router.post('/change-password', verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    const user = await User.findById(req.user._id).select('+password');
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ message: 'Mật khẩu hiện tại không đúng' });
    }
    user.password = newPassword;
    await user.save();
    res.json({ message: 'Đổi mật khẩu thành công' });
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});

// Báo cáo doanh thu
router.get('/revenue', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const now = new Date();

    let fromDate, toDate;

    if (startDate || endDate) {
      // Cả hai phải có, nếu thiếu 1 thì báo lỗi
      if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Cần truyền cả startDate và endDate (YYYY-MM-DD)' });
      }

      // Parse thô startDate và endDate
      const partsStart = startDate.split('-');
      const partsEnd = endDate.split('-');

      if (
        partsStart.length !== 3 || partsEnd.length !== 3 ||
        isNaN(partsStart[0]) || isNaN(partsStart[1]) || isNaN(partsStart[2]) ||
        isNaN(partsEnd[0]) || isNaN(partsEnd[1]) || isNaN(partsEnd[2])
      ) {
        return res.status(400).json({ message: 'Định dạng startDate hoặc endDate không hợp lệ (phải YYYY-MM-DD)' });
      }

      const yearS = parseInt(partsStart[0], 10);
      const monthS = parseInt(partsStart[1], 10) - 1;
      const dayS = parseInt(partsStart[2], 10);
      const yearE = parseInt(partsEnd[0], 10);
      const monthE = parseInt(partsEnd[1], 10) - 1;
      const dayE = parseInt(partsEnd[2], 10);

      fromDate = new Date(yearS, monthS, dayS, 0, 0, 0, 0);
      toDate   = new Date(yearE, monthE, dayE, 23, 59, 59, 999);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ message: 'startDate hoặc endDate không phải ngày hợp lệ' });
      }
      if (toDate < fromDate) {
        return res.status(400).json({ message: 'endDate phải lớn hơn hoặc bằng startDate' });
      }

      // Kiểm tra khoảng cách <= 3 tháng (~93 ngày)
      const diffMs = toDate.getTime() - fromDate.getTime();
      const maxRangeMs = 1000 * 60 * 60 * 24 * 93; // 93 ngày * 24h * 60p * 60s * 1000ms
      if (diffMs > maxRangeMs) {
        return res.status(400).json({ message: 'Khoảng thời gian không vượt quá 3 tháng' });
      }
    } else {
      // Nếu không truyền startDate & endDate, lấy ngày hôm nay
      const year0 = now.getFullYear();
      const month0 = now.getMonth();
      const day0 = now.getDate();
      fromDate = new Date(year0, month0, day0, 0, 0, 0, 0);
      toDate   = new Date(year0, month0, day0, 23, 59, 59, 999);
    }

    // Tiến hành query: các order “Đã giao” có createdAt từDate <= createdAt <= toDate
    const orders = await Order.find({
      shipper: req.user._id,
      status: 'Đã giao',
      createdAt: { $gte: fromDate, $lte: toDate }
    });

    const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
    const completedOrders = orders.length;

    return res.json({
      period: {
        startDate: fromDate.toISOString().split('T')[0], // 'YYYY-MM-DD'
        endDate: toDate.toISOString().split('T')[0]
      },
      totalRevenue,
      completedOrders
    });
  } catch (error) {
    console.error('Lỗi báo cáo doanh thu:', error);
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});
router.get('/order-counts', verifyToken, shipperController.getOrderCounts);

module.exports = router;
