// controllers/orderController.js
const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const sendPushNotification = require('../utils/sendPushNotification');
const assignOrderToNearestShipper = require('../utils/assignOrderToShipper');


// Tạo đơn hàng mới
const createOrder = async (req, res) => {
  try {
    const {
      items, total, phone,
      shippingAddress, customerName,
      paymentMethod
    } = req.body;
 // 1. Kiểm tra khung giờ cho mỗi sản phẩm
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    for (const item of items) {
      const prod = await Product.findById(item.productId);
      if (!prod) {
        return res.status(404).json({ message: `Sản phẩm "${item.name}" không tồn tại` });
      }
      if (prod.saleStartTime && prod.saleEndTime) {
        const toMin = (str) => {
          const [h, m] = str.split(':').map(Number);
          return h * 60 + m;
        };
        const start = toMin(prod.saleStartTime);
        const end   = toMin(prod.saleEndTime);
        let ok;
        if (start <= end) {
          ok = nowMin >= start && nowMin <= end;
        } else {
          ok = nowMin >= start || nowMin <= end;
        }
        if (!ok) {
          return res.status(400).json({
            message: `Sản phẩm "${prod.name}" chỉ bán từ ${prod.saleStartTime} đến ${prod.saleEndTime}`
          });
        }
      }
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Không có sản phẩm trong đơn hàng' });
    }

    const newOrder = new Order({
      items, total, phone,
      shippingAddress, customerName,
      user: req.user._id,
      status: 'Chờ xác nhận',
      paymentMethod
    });

    const savedOrder = await newOrder.save();
    await assignToNearestShipper(savedOrder);
    // Gửi thông báo cho admin
    const admins = await User.find({
      isAdmin: true,
      expoPushToken: { $exists: true, $ne: null }
    });
    for (const admin of admins) {
      await sendPushNotification(
        admin.expoPushToken,
        '🛒 Có đơn hàng mới!',
        `Người dùng ${req.user.name || 'khách'} vừa đặt hàng. Tổng: ${total.toLocaleString()}đ`
      );
    }

    res.status(201).json(savedOrder);
  } catch (err) {
    console.error('[BACKEND] Lỗi tạo đơn hàng:', err);
    res.status(500).json({ message: 'Lỗi tạo đơn hàng', error: err.message });
  }
};



// Lấy đơn hàng của user (có thể lọc theo status)
const getMyOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const query = { user: req.user._id };
    if (status) query.status = status;
    const orders = await Order.find(query).sort({ createdAt: -1 });
    res.status(200).json(orders);
  } catch (err) {
    console.error('[BACKEND] Lỗi lấy đơn hàng của user:', err);
    res.status(500).json({ message: 'Lỗi server khi lấy đơn hàng của bạn' });
  }
};

// Đếm số lượng đơn hàng theo trạng thái
const countOrdersByStatus = async (req, res) => {
  try {
    const all = await Order.find({ user: req.user._id });
    const counts = all.reduce((acc, o) => {
      switch (o.status) {
        case 'Chờ xác nhận': acc.pending++; break;
        case 'Đang xử lý':    acc.confirmed++; break;
        case 'Đang giao':     acc.shipped++; break;
        case 'Đã giao':       acc.delivered++; break;
        case 'Đã hủy':        acc.canceled++; break;
      }
      return acc;
    }, { pending:0, confirmed:0, shipped:0, delivered:0, canceled:0 });
    res.status(200).json(counts);
  } catch (err) {
    console.error('[BACKEND] Lỗi đếm đơn theo status:', err);
    res.status(500).json({ message: 'Lỗi khi đếm đơn hàng theo trạng thái' });
  }
};

// Lấy chi tiết đơn hàng (user hoặc admin)
const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }
    if (!req.user.isAdmin && order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Bạn không có quyền xem đơn hàng này' });
    }
    res.json(order);
  } catch (err) {
    console.error('[BACKEND] Lỗi lấy chi tiết đơn hàng:', err);
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'ID đơn hàng không hợp lệ' });
    }
    res.status(500).json({ message: 'Lỗi server khi lấy chi tiết đơn hàng' });
  }
};

// Admin: Lấy tất cả đơn hàng, có thể lọc theo status
const getAllOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const orders = await Order.find(query)
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error('[BACKEND] Lỗi lấy danh sách đơn hàng:', err);
    res.status(500).json({ message: 'Lỗi lấy danh sách đơn hàng', error: err.message });
  }
};

// Admin: Cập nhật trạng thái đơn hàng
const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ message: 'Thiếu trường status' });
    }
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }
    order.status = status;
    const updated = await order.save();
    res.json({ message: 'Cập nhật trạng thái thành công', order: updated });
  } catch (err) {
    console.error('[BACKEND] Lỗi cập nhật đơn hàng:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        message: 'Trạng thái không hợp lệ',
        validStatuses: ['Chờ xác nhận','Đang xử lý','Đang giao','Đã giao','Đã hủy']
      });
    }
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'ID đơn hàng không hợp lệ' });
    }
    res.status(500).json({ message: 'Lỗi cập nhật đơn hàng', error: err.message });
  }
};

// Hủy đơn (user hoặc admin)
const cancelOrder = async (req, res) => {
  try {
    const query = req.user.isAdmin
      ? { _id: req.params.id }
      : { _id: req.params.id, user: req.user._id };

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng hoặc không có quyền' });
    }
    if (order.status !== 'Chờ xác nhận') {
      return res.status(400).json({
        message: 'Chỉ có thể hủy đơn hàng ở trạng thái "Chờ xác nhận"'
      });
    }

    // **Use exact enum string**
    order.status = 'Đã hủy';
    const updated = await order.save();

    res.json({ message: 'Hủy đơn hàng thành công', order: updated });
  } catch (err) {
    console.error('[BACKEND] Lỗi hủy đơn hàng:', err);
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'ID đơn hàng không hợp lệ' });
    }
    res.status(500).json({ message: 'Lỗi hủy đơn hàng', error: err.message });
  }
};


const assignToNearestShipper = async (order) => {
  const shippers = await User.aggregate([
    {
      $geoNear: {
        near: {
          type: 'Point',
          coordinates: order.shippingLocation.coordinates
        },
        distanceField: 'distance',
        maxDistance: 10000, // 10km
        query: { 
          role: 'shipper',
          isAvailable: true 
        },
        spherical: true
      }
    },
    { $limit: 3 }
  ]);

  if (shippers.length > 0) {
    order.shipper = shippers[0]._id;
    await order.save();
    
    // Gửi thông báo đến shipper
    sendPushNotification(shippers[0].expoPushToken, {
      title: 'Đơn hàng mới',
      body: `Bạn có đơn hàng mới cách ${(shippers[0].distance / 1000).toFixed(1)}km`
    });
  }
};




module.exports = {
  createOrder,
  getMyOrders,
  countOrdersByStatus,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  cancelOrder,
  assignToNearestShipper
};
