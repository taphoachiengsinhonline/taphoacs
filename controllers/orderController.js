// controllers/orderController.js
const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const { findNearestStaff, calculateDistance } = require('../utils/geoUtils');
const sendPushNotification = require('../utils/sendPushNotification');

// [1] Tạo đơn hàng mới (Cập nhật phiên bản có tích hợp vị trí)
const createOrder = async (req, res) => {
  try {
    const { items, total, phone, shippingAddress, customerName, paymentMethod, lng, lat } = req.body;

    // Kiểm tra khung giờ bán hàng
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const item of items) {
      const prod = await Product.findById(item.productId);
      if (!prod) return res.status(404).json({ message: `Sản phẩm "${item.name}" không tồn tại` });
      
      if (prod.saleStartTime && prod.saleEndTime) {
        const toMin = (str) => str.split(':').map(Number).reduce((h, m) => h * 60 + m);
        const [start, end] = [toMin(prod.saleStartTime), toMin(prod.saleEndTime)];
        const validTime = start <= end ? (nowMin >= start && nowMin <= end) : (nowMin >= start || nowMin <= end);
        if (!validTime) return res.status(400).json({ 
          message: `Sản phẩm "${prod.name}" chỉ bán từ ${prod.saleStartTime} đến ${prod.saleEndTime}`
        });
      }
    }

    // Tạo đơn hàng với thông tin vị trí
    const newOrder = new Order({
      items,
      total,
      phone,
      shippingAddress,
      customerName,
      paymentMethod,
      user: req.user._id,
      status: 'Chờ xác nhận',
      shippingLocation: {
        type: 'Point',
        coordinates: [parseFloat(lng), parseFloat(lat)]
      }
    });

    const savedOrder = await newOrder.save();

    // Tìm và thông báo cho nhân viên gần nhất
    const nearestStaff = await findNearestStaff(savedOrder.shippingLocation.coordinates, 10);
    if (nearestStaff.length > 0) {
      req.app.get('io').emit('newOrder', { 
        orderId: savedOrder._id,
        staffIds: nearestStaff.map(s => s._id)
      });
      
      const fcmTokens = nearestStaff.filter(s => s.fcmToken).map(s => s.fcmToken);
      if (fcmTokens.length > 0) {
        await sendPushNotification(
          fcmTokens,
          '📦 Đơn hàng mới gần bạn',
          `${customerName} - ${shippingAddress}`
        );
      }
    }

    // Gửi thông báo cho admin
    const admins = await User.find({ isAdmin: true, fcmToken: { $exists: true } });
    for (const admin of admins) {
      await sendPushNotification(
        admin.fcmToken,
        '🛒 Đơn hàng mới',
        `Tổng giá trị: ${total.toLocaleString()}đ`
      );
    }

    res.status(201).json(savedOrder);
  } catch (err) {
    console.error('[ORDER] Lỗi tạo đơn:', err);
    res.status(500).json({ message: 'Lỗi tạo đơn hàng', error: err.message });
  }
};

// [2] Các hàm gốc giữ nguyên
const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).sort('-createdAt');
    res.json(orders);
  } catch (err) {
    console.error('[ORDER] Lỗi lấy đơn:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

const countOrdersByStatus = async (req, res) => {
  try {
    const counts = await Order.aggregate([
      { $match: { user: mongoose.Types.ObjectId(req.user._id) } },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    res.json(counts.reduce((acc, cur) => ({ ...acc, [cur._id]: cur.count }), {}));
  } catch (err) {
    console.error('[ORDER] Lỗi thống kê:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email')
      .populate('deliveryStaff', 'name phone');
    
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn' });
    if (!req.user.isAdmin && order.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Không có quyền truy cập' });
    }
    res.json(order);
  } catch (err) {
    console.error('[ORDER] Lỗi chi tiết:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

const getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('user', 'name phone')
      .populate('deliveryStaff', 'name')
      .sort('-createdAt');
    res.json(orders);
  } catch (err) {
    console.error('[ORDER] Lỗi lấy tất cả:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn' });
    
    order.status = req.body.status;
    const updatedOrder = await order.save();
    
    // Gửi thông báo real-time
    req.app.get('io').emit('orderUpdate', updatedOrder);
    if (updatedOrder.user?.fcmToken) {
      await sendPushNotification(
        updatedOrder.user.fcmToken,
        '🔔 Trạng thái đơn hàng',
        `Đơn hàng #${updatedOrder._id} đã chuyển sang "${req.body.status}"`
      );
    }
    
    res.json(updatedOrder);
  } catch (err) {
    console.error('[ORDER] Lỗi cập nhật:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

const cancelOrder = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      $or: [{ user: req.user._id }, { deliveryStaff: req.user._id }]
    });
    
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn' });
    if (!['Chờ xác nhận', 'Đang xử lý'].includes(order.status)) {
      return res.status(400).json({ message: 'Không thể hủy đơn này' });
    }
    
    order.status = 'Đã hủy';
    await order.save();
    res.json({ message: 'Hủy đơn thành công' });
  } catch (err) {
    console.error('[ORDER] Lỗi hủy đơn:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// [3] Các hàm mới cho nhân viên giao hàng
const getAvailableDeliveryOrders = async (req, res) => {
  try {
    const staffLocation = req.user.deliveryInfo?.location?.coordinates;
    if (!staffLocation) return res.status(400).json({ message: 'Vui lòng bật định vị' });

    const orders = await Order.find({
      status: 'Đang xử lý',
      deliveryStaff: null,
      shippingLocation: {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: staffLocation
          },
          $maxDistance: 20000 // 20km
        }
      }
    }).populate('user', 'name address phone');

    res.json(orders);
  } catch (err) {
    console.error('[DELIVERY] Lỗi lấy đơn:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

const acceptOrderDelivery = async (req, res) => {
  try {
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, deliveryStaff: null },
      { 
        deliveryStaff: req.user._id,
        status: 'Đang giao',
        assignedAt: new Date()
      },
      { new: true }
    );
    
    if (!order) return res.status(400).json({ message: 'Đơn không khả dụng' });
    
    await User.findByIdAndUpdate(req.user._id, {
      'deliveryInfo.status': 'busy',
      $push: { 'deliveryInfo.currentOrders': order._id }
    });

    res.json(order);
  } catch (err) {
    console.error('[DELIVERY] Lỗi nhận đơn:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

const updateDeliveryStatus = async (req, res) => {
  try {
    const { status, lat, lng } = req.body;
    const updateData = { status };
    
    if (lat && lng) {
      updateData.$push = {
        tracking: {
          location: { type: 'Point', coordinates: [lng, lat] },
          timestamp: new Date()
        }
      };
    }

    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, deliveryStaff: req.user._id },
      updateData,
      { new: true }
    );

    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn' });
    res.json(order);
  } catch (err) {
    console.error('[DELIVERY] Lỗi cập nhật:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

const getMyAssignedOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      deliveryStaff: req.user._id,
      status: { $in: ['Đang giao', 'Đã giao'] }
    }).sort('-assignedAt');
    
    res.json(orders);
  } catch (err) {
    console.error('[DELIVERY] Lỗi lấy đơn:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};



const updateOrderLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (!lat || !lng) {
      return res.status(400).json({ message: 'Vui lòng cung cấp tọa độ lat và lng' });
    }

    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, deliveryStaff: req.user._id },
      {
        $push: {
          tracking: {
            location: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
            timestamp: new Date()
          }
        }
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng hoặc bạn không được phân công' });
    }

    // Gửi thông báo real-time
    req.app.get('io').emit('orderLocationUpdate', {
      orderId: order._id,
      location: { lat, lng }
    });

    res.json(order);
  } catch (err) {
    console.error('[ORDER] Lỗi cập nhật vị trí:', err);
    res.status(500).json({ message: 'Lỗi server' });
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
  // Delivery functions
  getAvailableDeliveryOrders,
  acceptOrderDelivery,
  updateDeliveryStatus,
  getMyAssignedOrders
};
