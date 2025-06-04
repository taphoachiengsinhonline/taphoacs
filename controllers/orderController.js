// controllers/orderController.js
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const sendPushNotification = require('../utils/sendPushNotification');
const assignOrderToNearestShipper = require('../utils/assignOrderToNearestShipper');

/**
 * Tạo đơn hàng mới:
 * 1. Kiểm tra giờ bán của từng sản phẩm (saleStartTime, saleEndTime)
 * 2. Kiểm tra tồn kho và giảm countInStock
 * 3. Lưu đơn hàng (kèm shippingLocation)
 * 4. Gán shipper gần nhất bất đồng bộ
 * 5. Gửi notification cho admin
 */
exports.createOrder = async (req, res) => {
  try {
    const {
      items,
      total,
      phone,
      shippingAddress,
      shippingLocation,   // { type: 'Point', coordinates: [lng, lat] }
      customerName,
      paymentMethod
    } = req.body;

    // 1. Validate payload cơ bản
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Giỏ hàng không được để trống' });
    }
    if (!phone || !shippingAddress || !shippingLocation) {
      return res.status(400).json({ message: 'Thiếu số điện thoại, địa chỉ hoặc tọa độ giao hàng' });
    }

    // 2. Kiểm tra khung giờ & giảm tồn kho
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    for (const item of items) {
      const prod = await Product.findById(item.productId);
      if (!prod) {
        return res.status(404).json({ message: `Sản phẩm "${item.name}" không tồn tại` });
      }

      // Khung giờ bán (nếu có)
      if (prod.saleStartTime && prod.saleEndTime) {
        const toMin = str => {
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

      // Kiểm tra kho
      if (prod.countInStock < item.quantity) {
        return res.status(400).json({ message: `Sản phẩm "${prod.name}" không đủ hàng trong kho` });
      }
      prod.countInStock -= item.quantity;
      await prod.save();
    }

    // 3. Tạo & lưu đơn
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
    const saved = await order.save();

    // 4. Gán shipper gần nhất (không block request)
    console.log(`🟢 Bắt đầu gán shipper cho đơn ${saved._id}`);
    assignOrderToNearestShipper(saved._id)
      .catch(err => console.error('[assignOrder] error:', err));

    // 5. Gửi notification cho admin
    const admins = await User.find({
      role: 'admin',
      fcmToken: { $exists: true, $ne: null }
    });
    for (const a of admins) {
      sendPushNotification(a.fcmToken, {
        title: '🛒 Đơn hàng mới',
        body: `#${saved._id.slice(-6)} từ ${req.user.name || 'khách'}: ${total.toLocaleString()}đ`,
        data: { orderId: saved._id }
      }).catch(e => console.error('[notify admin] error:', e));
    }

    return res.status(201).json({
      message: 'Đơn hàng đã được tạo thành công',
      order: saved
    });
  } catch (err) {
    console.error('[createOrder] error:', err);
    return res.status(500).json({ message: 'Lỗi server khi tạo đơn hàng', error: err.message });
  }
};

/**
 * Lấy đơn hàng của chính user, có thể lọc theo status
 */
exports.getMyOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const query = { user: req.user._id };
    if (status) query.status = status;
    const orders = await Order.find(query).sort({ createdAt: -1 });
    return res.status(200).json(orders);
  } catch (err) {
    console.error('[getMyOrders] error:', err);
    return res.status(500).json({ message: 'Lỗi server khi lấy đơn hàng của bạn' });
  }
};

/**
 * Đếm số lượng đơn theo từng trạng thái cho user
 */
exports.countOrdersByStatus = async (req, res) => {
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
    return res.status(200).json(counts);
  } catch (err) {
    console.error('[countOrdersByStatus] error:', err);
    return res.status(500).json({ message: 'Lỗi server khi đếm đơn hàng theo trạng thái' });
  }
};

/**
 * Lấy chi tiết đơn theo id (user hoặc admin)
 */
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name phone')
      .populate('shipper', 'name phone');

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    // Cho phép admin, khách hàng và shipper được giao xem đơn
    const isAdmin = req.user?.isAdmin;
    const isCustomer = order.user?._id.toString() === req.user?._id?.toString();
    const isAssignedShipper = order.shipper?._id.toString() === req.user?._id?.toString();
    
    // Cho phép shipper xem đơn hàng chưa được nhận
    const isShipperViewingPendingOrder = req.query.shipperView === 'true' && 
                                        order.status === 'Chờ xác nhận' &&
                                        req.user?.role === 'shipper';

    if (isAdmin || isCustomer || isAssignedShipper || isShipperViewingPendingOrder) {
      return res.json(order);
    }

    return res.status(403).json({ message: 'Bạn không có quyền xem đơn hàng này' });
  } catch (err) {
    console.error('[getOrderById] error:', err);
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'ID đơn hàng không hợp lệ' });
    }
    return res.status(500).json({ message: 'Lỗi server khi lấy chi tiết đơn hàng' });
  }
};

/**
 * Admin: Lấy tất cả đơn hàng, có thể lọc theo status
 */
exports.getAllOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const orders = await Order.find(query)
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    return res.json(orders);
  } catch (err) {
    console.error('[getAllOrders] error:', err);
    return res.status(500).json({ message: 'Lỗi server khi lấy danh sách đơn hàng', error: err.message });
  }
};

/**
 * Admin: Cập nhật trạng thái đơn hàng
 */
exports.updateOrderStatus = async (req, res) => {
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
    return res.json({ message: 'Cập nhật trạng thái thành công', order: updated });
  } catch (err) {
    console.error('[updateOrderStatus] error:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        message: 'Trạng thái không hợp lệ',
        validStatuses: ['Chờ xác nhận','Đang xử lý','Đang giao','Đã giao','Đã hủy']
      });
    }
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'ID đơn hàng không hợp lệ' });
    }
    return res.status(500).json({ message: 'Lỗi server khi cập nhật đơn hàng', error: err.message });
  }
};

/**
 * Hủy đơn (user hoặc admin)
 */
exports.cancelOrder = async (req, res) => {
  try {
    const query = req.user.isAdmin
      ? { _id: req.params.id }
      : { _id: req.params.id, user: req.user._id };
    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng hoặc không có quyền' });
    }
    if (order.status !== 'Chờ xác nhận') {
      return res.status(400).json({ message: 'Chỉ có thể hủy đơn ở trạng thái "Chờ xác nhận"' });
    }
    order.status = 'Đã hủy';
    const updated = await order.save();
    return res.json({ message: 'Hủy đơn hàng thành công', order: updated });
  } catch (err) {
    console.error('[cancelOrder] error:', err);
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'ID đơn hàng không hợp lệ' });
    }
    return res.status(500).json({ message: 'Lỗi server khi hủy đơn hàng', error: err.message });
  }
};
