// routes/shipperRoutes.js
const PendingDelivery = require('../models/PendingDelivery');
const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const Order = require('../models/Order');
const User = require('../models/User');
const bcrypt = require('bcrypt');
const { sendPushNotificationToCustomer } = require('../utils/sendPushNotification');
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
// Sửa endpoint /shippers/assigned-orders
router.get('/assigned-orders', verifyToken, async (req, res) => {
  try {
    const orders = await Order.find({ 
      shipper: req.user._id,
      status: { $in: ['Đang xử lý', 'Đang giao', 'Đã giao', 'Đã huỷ'] } // Thêm trạng thái
    }).sort('-createdAt');
    console.log('[Backend] Assigned orders:', orders); // Debug
    res.json(orders);
  } catch (error) {
    console.error('Lỗi server:', error);
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
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
    const totalRevenue = completedOrdersList.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

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
    const { period, date } = req.query;
    const now = new Date();

    // ---------------------------------------------
    // 1. Tính previousMonthRevenue và previousMonthCompletedOrders
    //    (tháng liền trước so với hiện tại)
    // Ví dụ: nếu bây giờ là 15/06/2025 thì tháng trước = 05/2025
    //    startPrev = 2025-05-01 00:00:00
    //    endPrev   = 2025-05-31 23:59:59.999
    // ---------------------------------------------
    const yearNow = now.getFullYear();
    const monthNow = now.getMonth(); // 0-based (0 = Jan, 5 = Jun)
    // Xác định tháng trước (lùi 1 nếu monthNow>0; nếu monthNow=0 (tháng 1), tháng trước = tháng 12 của năm trước)
    const prevMonth = monthNow === 0 ? 11 : monthNow - 1; // 0..11
    const prevYear = monthNow === 0 ? yearNow - 1 : yearNow;

    // startPrev: ngày đầu tháng trước, 00:00:00
    const startPrev = new Date(prevYear, prevMonth, 1, 0, 0, 0, 0);
    // endPrev: ngày cuối cùng của tháng trước, 23:59:59.999
    const endPrev  = new Date(prevYear, prevMonth + 1, 1, 0, 0, 0, 0) - 1;
    // (ta có thể tạo new Date(prevYear, prevMonth+1, 0) để tự động về ngày 0 của tháng+1, tức cuối của tháng trước)
    // const endPrev = new Date(prevYear, prevMonth + 1, 0, 23, 59, 59, 999);

    // Query Mongo để lấy tất cả đơn “Đã giao” của shipper trong khoảng startPrev -> endPrev
    const prevOrders = await Order.find({
      shipper: req.user._id,
      status: 'Đã giao',
      createdAt: { $gte: startPrev, $lte: new Date(endPrev) }
    });

    const previousMonthRevenue = prevOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const previousMonthCompletedOrders = prevOrders.length;

    // ---------------------------------------------
    // 2. Nếu client truyền `date=YYYY-MM-DD`, ta chỉ tính doanh thu của đúng ngày đó
    //    VD: date = '2025-06-03'
    //    startDate = '2025-06-03 00:00:00'
    //    endDate   = '2025-06-03 23:59:59.999'
    //    Trả về { totalRevenue, completedOrders } cho ngày đó + previousMonthXXX
    // ---------------------------------------------
    if (date) {
      // Kiểm tra format date hợp lệ (có thể dùng regex đơn giản)
      // Ở đây giả sử client đã gửi đúng 'YYYY-MM-DD'
      const parts = date.split('-');
      if (
        parts.length !== 3 ||
        isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])
      ) {
        return res.status(400).json({ message: 'Ngày không hợp lệ (phải YYYY-MM-DD)' });
      }

      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // 0-based
      const day = parseInt(parts[2], 10);

      // Tạo startDate và endDate
      const startDate = new Date(year, month, day, 0, 0, 0, 0);
      const endDate   = new Date(year, month, day, 23, 59, 59, 999);

      // Lấy orders đã giao trong ngày đó
      const dailyOrders = await Order.find({
        shipper: req.user._id,
        status: 'Đã giao',
        createdAt: { $gte: startDate, $lte: endDate }
      });

      const totalRevenueToday = dailyOrders.reduce((sum, o) => sum + (o.total || 0), 0);
      const completedOrdersToday = dailyOrders.length;

      return res.json({
        // thông tin ngày cụ thể
        periodType: 'daily',
        period: date, // '2025-06-03'
        totalRevenue: totalRevenueToday,
        completedOrders: completedOrdersToday,
        // phần tháng trước
        previousMonthRevenue,
        previousMonthCompletedOrders
      });
    }

    // ---------------------------------------------
    // 3. Nếu không có `date`, xét đến `period` như cũ (daily/weekly/monthly/yearly)
    //    (không cần support mảng details nữa, chỉ trả summary cho khoảng)
    // ---------------------------------------------
    if (!period) {
      return res.status(400).json({ message: 'Thiếu tham số period hoặc date' });
    }

    // Tính startDate suất phát từ period (giống trước)
    let startDate;
    switch (period) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        break;
      case 'weekly':
        const d = now.getDay(); // 0..6 (0 = Chủ nhật)
        startDate = new Date(now);
        startDate.setDate(now.getDate() - d);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        break;
      case 'yearly':
        startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        break;
      default:
        return res.status(400).json({ message: 'Thời gian không hợp lệ' });
    }

    // Lấy tất cả orders “Đã giao” từ startDate đến hiện tại
    const orders = await Order.find({
      shipper: req.user._id,
      status: 'Đã giao',
      createdAt: { $gte: startDate }
    });

    const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
    const completedOrders = orders.length;

    return res.json({
      periodType: period,            // 'daily'|'weekly'|'monthly'|'yearly'
      // Không trả mảng chi tiết, chỉ summary cho khoảng
      totalRevenue,
      completedOrders,
      previousMonthRevenue,
      previousMonthCompletedOrders
    });
  } catch (error) {
    console.error('Lỗi báo cáo doanh thu:', error);
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});

module.exports = router;
