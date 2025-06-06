const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const sendPushNotification = require('../utils/sendPushNotification');
const assignOrderToNearestShipper = require('../utils/assignOrderToNearestShipper');

const validateSaleTime = (product, nowMin) => {
  const toMin = str => {
    const [h, m] = str.split(':').map(Number);
    return h * 60 + m;
  };
  
  const start = toMin(product.saleStartTime);
  const end = toMin(product.saleEndTime);
  
  if (start <= end) {
    return nowMin >= start && nowMin <= end;
  } 
  return nowMin >= start || nowMin <= end;
};

const processOrderItem = async (item) => {
  const prod = await Product.findById(item.productId);
  if (!prod) throw new Error(`Sản phẩm "${item.name}" không tồn tại`);

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (prod.saleStartTime && prod.saleEndTime) {
    if (!validateSaleTime(prod, nowMin)) {
      throw new Error(`Sản phẩm "${prod.name}" chỉ bán từ ${prod.saleStartTime} đến ${prod.saleEndTime}`);
    }
  }

  if (prod.countInStock < item.quantity) {
    throw new Error(`Sản phẩm "${prod.name}" không đủ hàng trong kho`);
  }
  
  prod.countInStock -= item.quantity;
  await prod.save();
  return prod;
};

const notifyAdmins = async (order, total, userName) => {
  const admins = await User.find({ role: 'admin', fcmToken: { $exists: true } });
  for (const admin of admins) {
    try {
      await sendPushNotification(admin.fcmToken, {
        title: '🛒 Đơn hàng mới',
        body: `#${order._id.toString().slice(-6)} từ ${userName || 'khách'}: ${total.toLocaleString()}đ`,
        data: { orderId: order._id }
      });
    } catch (e) {
      console.error(`Lỗi thông báo cho admin ${admin._id}:`, e);
    }
  }
};

exports.createOrder = async (req, res) => {
  try {
    const { items, total, phone, shippingAddress, shippingLocation, customerName, paymentMethod } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Giỏ hàng không được để trống' });
    }
    if (!phone || !shippingAddress || !shippingLocation) {
      return res.status(400).json({ message: 'Thiếu thông tin giao hàng' });
    }

    await Promise.all(items.map(item => processOrderItem(item)));

    const order = new Order({
      items,
      total,
      phone,
      shippingAddress,
      shippingLocation,
      customerName,
      paymentMethod,
      status: 'Chờ xác nhận',
      user: req.user._id
    });
    
    const savedOrder = await order.save();

    assignOrderToNearestShipper(savedOrder._id).catch(console.error);
    notifyAdmins(savedOrder, total, req.user?.name);

    return res.status(201).json({
      message: 'Tạo đơn thành công',
      order: { ...savedOrder.toObject(), timestamps: savedOrder.timestamps }
    });
  } catch (err) {
    const statusCode = err.message.includes('không tồn tại') || err.message.includes('không đủ hàng') ? 400 : 500;
    return res.status(statusCode).json({ message: err.message });
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const query = { user: req.user._id };
    if (status) query.status = status;

    const skip = (page - 1) * limit;
    const [total, orders] = await Promise.all([
      Order.countDocuments(query),
      Order.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
    ]);

    return res.status(200).json({
      orders: orders.map(o => ({ ...o.toObject(), timestamps: o.timestamps })),
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Lỗi lấy đơn hàng:', err);
    return res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.countOrdersByStatus = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id });
    const counts = orders.reduce((acc, o) => {
      acc[o.status] = (acc[o.status] || 0) + 1;
      return acc;
    }, {});
    return res.status(200).json(counts);
  } catch (err) {
    console.error('Lỗi đếm đơn:', err);
    return res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name phone')
      .populate('shipper', 'name phone');

    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn' });

    const isAllowed = req.user.isAdmin || 
      order.user?._id.toString() === req.user._id.toString() ||
      order.shipper?._id.toString() === req.user._id.toString();

    return isAllowed 
      ? res.json({ ...order.toObject(), timestamps: order.timestamps })
      : res.status(403).json({ message: 'Không có quyền truy cập' });
  } catch (err) {
    if (err.name === 'CastError') return res.status(400).json({ message: 'ID không hợp lệ' });
    return res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const query = status ? { status } : {};

    const skip = (page - 1) * limit;
    const [total, orders] = await Promise.all([
      Order.countDocuments(query),
      Order.find(query)
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
    ]);

    return res.json({
      orders: orders.map(o => ({ ...o.toObject(), timestamps: o.timestamps })),
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Lỗi lấy tất cả đơn:', err);
    return res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ message: 'Thiếu trạng thái' });

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn' });

    order.status = status;
    const now = new Date(Date.now() + 7*60*60*1000);

    switch(status) {
      case 'Chờ xác nhận': order.timestamps.pendingAt = now; break;
      case 'Đang xử lý': order.timestamps.acceptedAt = now; break;
      case 'Đang giao': order.timestamps.deliveringAt = now; break;
      case 'Đã giao': order.timestamps.deliveredAt = now; break;
      case 'Đã hủy': order.timestamps.canceledAt = now; break;
    }

    const updated = await order.save();
    return res.json({ 
      message: 'Cập nhật thành công', 
      order: { ...updated.toObject(), timestamps: updated.timestamps }
    });
  } catch (err) {
    console.error('Lỗi cập nhật:', err);
    return res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const query = req.user.isAdmin 
      ? { _id: req.params.id } 
      : { _id: req.params.id, user: req.user._id };

    const order = await Order.findOne(query);
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn' });

    if (order.status !== 'Chờ xác nhận') {
      return res.status(400).json({ message: 'Chỉ hủy được đơn chưa xác nhận' });
    }

    order.status = 'Đã hủy';
    order.timestamps.canceledAt = new Date(Date.now() + 7*60*60*1000);
    const updated = await order.save();

    return res.json({ 
      message: 'Hủy đơn thành công', 
      order: { ...updated.toObject(), timestamps: updated.timestamps }
    });
  } catch (err) {
    console.error('Lỗi hủy đơn:', err);
    return res.status(500).json({ message: 'Lỗi server' });
  }
};
