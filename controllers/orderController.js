// controllers/orderController.js
const Order   = require('../models/Order');
const Product = require('../models/Product');
const User    = require('../models/User');
const sendPushNotification    = require('../utils/sendPushNotification');
const assignOrderToNearestShipper = require('../utils/assignOrderToNearestShipper');

/**
 * Tạo đơn hàng mới:
 * 1. Validate payload
 * 2. Kiểm tra khung giờ & giảm tồn kho
 * 3. Lưu đơn hàng (kèm shippingLocation)
 * 4. Gán shipper gần nhất (background)
 * 5. Thông báo admin
 */
exports.createOrder = async (req, res) => {
  try {
    const {
      items,
      total,
      phone,
      shippingAddress,
      shippingLocation,    // { type: 'Point', coordinates: [lng, lat] }
      customerName,
      paymentMethod
    } = req.body;

    // 1. Validate cơ bản
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Giỏ hàng không được để trống' });
    }
    if (!phone || !shippingAddress || !shippingLocation?.coordinates) {
      return res.status(400).json({ message: 'Thiếu điện thoại, địa chỉ hoặc tọa độ giao hàng' });
    }

    // 2. Kiểm tra khung giờ & giãn tồn kho
    const nowMin = new Date().getHours()*60 + new Date().getMinutes();
    for (const i of items) {
      const prod = await Product.findById(i.productId);
      if (!prod) {
        return res.status(404).json({ message: `Sản phẩm "${i.name}" không tồn tại` });
      }
      // khung giờ bán (nếu có)
      if (prod.saleStartTime && prod.saleEndTime) {
        const toMin = s => {
          const [h,m] = s.split(':').map(Number);
          return h*60 + m;
        };
        const start = toMin(prod.saleStartTime),
              end   = toMin(prod.saleEndTime);
        const ok = start <= end
          ? nowMin>=start && nowMin<=end
          : nowMin>=start || nowMin<=end;
        if (!ok) {
          return res.status(400).json({
            message: `Sản phẩm "${prod.name}" chỉ bán từ ${prod.saleStartTime} đến ${prod.saleEndTime}`
          });
        }
      }
      // tồn kho
      if (prod.countInStock < i.quantity) {
        return res.status(400).json({ message: `Sản phẩm "${prod.name}" không đủ hàng` });
      }
      prod.countInStock -= i.quantity;
      await prod.save();
    }

    // 3. Tạo order
    const order = new Order({
      user: req.user._id,
      items,
      total,
      phone,
      shippingAddress,
      shippingLocation,
      customerName,
      paymentMethod,
      status: 'Chờ xác nhận'
    });
    const saved = await order.save();

    // 4. Gán shipper gần nhất (không chặn response)
    assignOrderToNearestShipper(saved._id).catch(err =>
      console.error('assignOrderToNearestShipper error:', err)
    );

    // 5. Thông báo admin
    const admins = await User.find({ role: 'admin', fcmToken: { $exists: true, $ne: null } });
    for (const a of admins) {
      await sendPushNotification(a.fcmToken, {
        title: '🛒 Đơn hàng mới',
        body: `Khách ${req.user.name||''} vừa đặt ${total.toLocaleString()}đ`,
        data: { orderId: saved._id }
      });
    }

    return res.status(201).json({ message: 'Tạo đơn thành công', order: saved });
  } catch (err) {
    console.error('[createOrder] error:', err);
    return res.status(500).json({ message: 'Lỗi server khi tạo đơn', error: err.message });
  }
};


/** Lấy đơn hàng của chính user, có thể filter theo status */
exports.getMyOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const q = { user: req.user._id };
    if (status) q.status = status;
    const orders = await Order.find(q).sort({ createdAt: -1 });
    return res.status(200).json(orders);
  } catch (err) {
    console.error('[getMyOrders] error:', err);
    return res.status(500).json({ message: 'Lỗi server khi lấy đơn của bạn' });
  }
};

/** Đếm số lượng đơn theo từng trạng thái cho user */
exports.countOrdersByStatus = async (req, res) => {
  try {
    const all = await Order.find({ user: req.user._id });
    const counts = all.reduce((acc,o) => {
      switch(o.status){
        case 'Chờ xác nhận': acc.pending++; break;
        case 'Đang xử lý':    acc.confirmed++; break;
        case 'Đang giao':     acc.shipped++; break;
        case 'Đã giao':       acc.delivered++; break;
        case 'Đã hủy':        acc.canceled++; break;
      }
      return acc;
    },{ pending:0, confirmed:0, shipped:0, delivered:0, canceled:0 });
    return res.status(200).json(counts);
  } catch (err) {
    console.error('[countOrdersByStatus] error:', err);
    return res.status(500).json({ message: 'Lỗi server khi đếm đơn' });
  }
};

/** Lấy chi tiết đơn (user hoặc admin) */
exports.getOrderById = async (req, res) => {
  try {
    const ord = await Order.findById(req.params.id);
    if (!ord) {
      return res.status(404).json({ message: 'Không tìm thấy đơn' });
    }
    if (!req.user.isAdmin && ord.user.toString()!==req.user._id.toString()) {
      return res.status(403).json({ message: 'Không có quyền xem' });
    }
    return res.json(ord);
  } catch (err) {
    console.error('[getOrderById] error:', err);
    if (err.name==='CastError') {
      return res.status(400).json({ message: 'ID không hợp lệ' });
    }
    return res.status(500).json({ message: 'Lỗi server khi lấy chi tiết' });
  }
};

/** Admin: Lấy tất cả đơn, filter theo status */
exports.getAllOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const q = status ? { status } : {};
    const orders = await Order.find(q)
      .populate('user','name email')
      .sort({ createdAt: -1 });
    return res.json(orders);
  } catch (err) {
    console.error('[getAllOrders] error:', err);
    return res.status(500).json({ message: 'Lỗi server khi lấy danh sách' });
  }
};

/** Admin: Cập nhật status */
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ message: 'Thiếu status' });
    }
    const ord = await Order.findById(req.params.id);
    if (!ord) {
      return res.status(404).json({ message: 'Không tìm thấy đơn' });
    }
    ord.status = status;
    const u = await ord.save();
    return res.json({ message: 'Cập nhật thành công', order: u });
  } catch (err) {
    console.error('[updateOrderStatus] error:', err);
    if (err.name==='ValidationError') {
      return res.status(400).json({
        message: 'Status không hợp lệ',
        valid: ['Chờ xác nhận','Đang xử lý','Đang giao','Đã giao','Đã hủy']
      });
    }
    if (err.name==='CastError') {
      return res.status(400).json({ message: 'ID không hợp lệ' });
    }
    return res.status(500).json({ message: 'Lỗi server khi cập nhật' });
  }
};

/** Hủy đơn (user hoặc admin) */
exports.cancelOrder = async (req, res) => {
  try {
    const q = req.user.isAdmin
      ? { _id: req.params.id }
      : { _id: req.params.id, user: req.user._id };

    const ord = await Order.findOne(q);
    if (!ord) {
      return res.status(404).json({ message: 'Không tìm thấy hoặc không có quyền' });
    }
    if (ord.status !== 'Chờ xác nhận') {
      return res.status(400).json({ message: 'Chỉ hủy khi "Chờ xác nhận"' });
    }
    ord.status = 'Đã hủy';
    const u = await ord.save();
    return res.json({ message: 'Hủy thành công', order: u });
  } catch (err) {
    console.error('[cancelOrder] error:', err);
    if (err.name==='CastError') {
      return res.status(400).json({ message: 'ID không hợp lệ' });
    }
    return res.status(500).json({ message: 'Lỗi server khi hủy' });
  }
};
