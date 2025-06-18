// Giữ nguyên các import và hàm phụ
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const sendPushNotification = require('../utils/sendPushNotification');
const assignOrderToNearestShipper = require('../utils/assignOrderToNearestShipper');
const { safeNotify } = require('../utils/notificationMiddleware');



exports.countByStatus = async (req, res) => {
  try {
    console.log('[countByStatus] Bắt đầu query'); // Log debug
    const counts = await Order.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]).exec(); // Đảm bảo query hoàn tất
    console.log('[countByStatus] Kết quả:', counts); // Log debug
    const result = counts.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});
    res.status(200).json({
      message: 'Lấy số lượng đơn hàng theo trạng thái thành công',
      counts: result
    });
  } catch (error) {
    console.error('[countByStatus] Lỗi:', error);
    res.status(500).json({ message: 'Lỗi server', error: error.message });
  }
};




const validateSaleTime = (product, nowMin) => {
  const toMin = str => {
    const [h, m] = str.split(':').map(Number);
    return h * 60 + m;
  };

  const start = toMin(product.saleStartTime);
  const end = toMin(product.saleEndTime);

  return start <= end 
    ? nowMin >= start && nowMin <= end
    : nowMin >= start || nowMin <= end;
};

const processOrderItem = async (item) => {
  const prod = await Product.findById(item.productId);
  if (!prod) throw new Error(`Sản phẩm "${item.name}" không tồn tại`);

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (prod.saleStartTime && prod.saleEndTime && !validateSaleTime(prod, nowMin)) {
    throw new Error(`Sản phẩm "${prod.name}" chỉ bán từ ${prod.saleStartTime} đến ${prod.saleEndTime}`);
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
      const orderId = order._id.toString();
      const orderIdShort = orderId.slice(-6);
      const customerName = userName || 'khách';
      const totalFormatted = total ? total.toLocaleString() : '0';
      
      await safeNotify(admin.fcmToken, {
        title: '🛒 Đơn hàng mới',
        body: `#${orderIdShort} từ ${customerName}: ${totalFormatted}đ`,
        data: { 
          orderId,
          shipperView: "true"
        }
      });
    } catch (e) {
      console.error(`[notify admin] error for admin ${admin._id}:`, e);
    }
  }
};

exports.createOrder = async (req, res) => {
  try {
    const { 
      items, 
      total, 
      phone, 
      shippingAddress, 
      shippingLocation, 
      customerName, 
      paymentMethod, 
      shippingFee, 
      voucherDiscount, 
      voucherCode 
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ message: 'Giỏ hàng không được để trống' });
    if (!phone || !shippingAddress || !shippingLocation) return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
    if (typeof shippingFee !== 'number' || shippingFee < 0) return res.status(400).json({ message: 'Phí ship không hợp lệ' });
    if (typeof voucherDiscount !== 'number' || voucherDiscount < 0) return res.status(400).json({ message: 'Giảm giá voucher không hợp lệ' });

    await Promise.all(items.map(processOrderItem));

    const order = new Order({
      items,
      total,
      phone,
      shippingAddress,
      shippingLocation,
      customerName,
      paymentMethod,
      shippingFee,
      voucherDiscount,
      voucherCode,
      status: 'Chờ xác nhận',
      user: req.user._id
    });

    const savedOrder = await order.save();
    assignOrderToNearestShipper(savedOrder._id).catch(console.error);
    notifyAdmins(savedOrder, total, req.user?.name);

    return res.status(201).json({
      message: 'Tạo đơn thành công',
      order: { 
        ...savedOrder.toObject(), 
        timestamps: savedOrder.timestamps
      }
    });
  } catch (err) {
    const statusCode = err.message.includes('không tồn tại') || err.message.includes('không đủ hàng') || err.message.includes('chỉ bán từ') ? 400 : 500;
    return res.status(statusCode).json({ message: err.message || 'Lỗi server' });
  }
};

// Giữ nguyên các hàm khác
exports.acceptOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Đơn hàng không tồn tại' });
    if (order.status !== 'Chờ xác nhận') return res.status(400).json({ message: 'Đơn không khả dụng' });

    order.status = 'Đang xử lý';
    order.shipper = req.user._id;
    order.timestamps.acceptedAt = new Date();
    
    const updated = await order.save();
    if (updated.user) {
      try {
        const customer = await User.findById(updated.user);
        if (customer?.fcmToken) {
          const orderId = order._id.toString();
          const orderIdShort = orderId.slice(-6);
          await safeNotify(customer.fcmToken, {
            title: 'Shipper đã nhận đơn',
            body: `Đơn hàng #${orderIdShort} đã được shipper nhận và đang chuẩn bị giao`,
            data: { 
              orderId,
              shipperView: "false"
            }
          });
        }
      } catch (notifError) {
        console.error('Lỗi gửi thông báo cho khách hàng:', notifError);
      }
    }
    
    res.json({ 
      message: 'Nhận đơn thành công',
      order: { ...updated.toObject(), timestamps: updated.timestamps }
    });
  } catch (error) {
    console.error('Lỗi nhận đơn:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.updateOrderStatusByShipper = async (req, res) => {
  try {
    const { status, cancelReason } = req.body;
    const order = await Order.findById(req.params.id);
    
    if (!order) return res.status(404).json({ message: 'Đơn hàng không tồn tại' });
    if (order.shipper.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Không có quyền thao tác' });

    if (status === 'Đang xử lý') {
      const activeOrders = await Order.countDocuments({
        shipper: req.user._id,
        status: { $in: ['Đang xử lý', 'Đang giao'] }
      });
      if (activeOrders >= 5) {
        return res.status(400).json({ message: 'Đã đạt tối đa 5 đơn cùng lúc' });
      }
    }

    const validTransitions = {
      'Đang xử lý': ['Đang giao', 'Đã huỷ'],
      'Đang giao': ['Đã giao', 'Đã huỷ']
    };

    if (!validTransitions[order.status]?.includes(status)) {
      return res.status(400).json({ message: 'Chuyển trạng thái không hợp lệ' });
    }

    order.status = status;
    const now = new Date();

    switch(status) {
      case 'Đang giao': order.timestamps.deliveringAt = now; break;
      case 'Đã giao': order.timestamps.deliveredAt = now; break;
      case 'Đã huỷ': 
        order.timestamps.canceledAt = now;
        order.cancelReason = cancelReason || 'Không có lý do';
        break;
    }

    const updated = await order.save();
    
    if (updated.user && ['Đang giao', 'Đã giao', 'Đã huỷ'].includes(status)) {
      try {
        const customer = await User.findById(updated.user);
        if (customer && customer.fcmToken) {
          const orderId = order._id.toString();
          const orderIdShort = orderId.slice(-6);
          let messageBody = '';
          
          switch(status) {
            case 'Đang giao':
              messageBody = `Đơn hàng #${orderIdShort} đang được giao đến bạn`;
              break;
            case 'Đã giao':
              messageBody = `Đơn hàng #${orderIdShort} đã giao thành công`;
              break;
            case 'Đã huỷ':
              messageBody = `Đơn hàng #${orderIdShort} đã bị huỷ`;
              break;
          }
          
          await safeNotify(customer.fcmToken, {
            title: 'Cập nhật đơn hàng',
            body: messageBody,
            data: { 
              orderId,
              shipperView: "false"
            }
          });
        }
      } catch (notifError) {
        console.error('Lỗi gửi thông báo cho khách hàng:', notifError);
      }
    }

    res.json({ 
      message: 'Cập nhật trạng thái thành công',
      order: { ...updated.toObject(), timestamps: updated.timestamps }
    });
  } catch (error) {
    console.error('Lỗi cập nhật:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.getShipperOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 }
    };

    const result = await Order.paginate(
      { shipper: req.user._id, ...(status && { status }) },
      options
    );

    res.json({
      orders: result.docs.map(doc => ({ ...doc.toObject(), timestamps: doc.timestamps })),
      totalPages: result.totalPages,
      currentPage: result.page,
      totalOrders: result.totalDocs
    });
  } catch (error) {
    console.error('Lỗi lấy đơn shipper:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const result = await Order.paginate(
      { user: req.user._id, ...(status && { status }) },
      { page, limit, sort: { createdAt: -1 } }
    );

    res.json({
      docs: result.docs.map(doc => ({ ...doc.toObject(), timestamps: doc.timestamps })),
      totalPages: result.totalPages,
      page: result.page
    });
  } catch (err) {
    console.error('[getMyOrders] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.countOrdersByStatus = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ' });
    }
    const all = await Order.find({ user: req.user._id });
    const counts = all.reduce((acc, o) => {
      switch (o.status) {
        case 'Chờ xác nhận': acc.pending++; break;
        case 'Đang xử lý': acc.confirmed++; break;
        case 'Đang giao': acc.shipped++; break;
        case 'Đã giao': acc.delivered++; break;
        case 'Đã huỷ': acc.canceled++; break;
      }
      return acc;
    }, { pending: 0, confirmed: 0, shipped: 0, delivered: 0, canceled: 0 });
    return res.status(200).json(counts);
  } catch (err) {
    console.error('[countOrdersByStatus] error:', err);
    return res.status(500).json({ message: 'Lỗi server khi đếm đơn hàng theo trạng thái' });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name phone')
      .populate('shipper', 'name phone');

    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });

    const canView = [
      req.user.isAdmin,
      order.user?._id.equals(req.user._id),
      order.shipper?._id.equals(req.user._id),
      req.query.shipperView === 'true' && order.status === 'Chờ xác nhận' && req.user.role === 'shipper'
    ].some(Boolean);

    canView 
      ? res.json({ ...order.toObject(), timestamps: order.timestamps })
      : res.status(403).json({ message: 'Không có quyền truy cập' });
  } catch (err) {
    console.error('[getOrderById] error:', err);
    res.status(err.name === 'CastError' ? 400 : 500).json({ message: err.message || 'Lỗi server' });
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const result = await Order.paginate(
      { ...(status && { status }) },
      { page, limit, sort: { createdAt: -1 }, populate: 'user' }
    );

    res.json({
      docs: result.docs.map(doc => ({ ...doc.toObject(), timestamps: doc.timestamps })),
      totalPages: result.totalPages,
      page: result.page
    });
  } catch (err) {
    console.error('[getAllOrders] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ message: 'Thiếu trạng thái' });

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });

    const now = new Date();
    order.status = status;
    
    switch(status) {
      case 'Đang xử lý': order.timestamps.acceptedAt = now; break;
      case 'Đang giao': order.timestamps.deliveringAt = now; break;
      case 'Đã giao': order.timestamps.deliveredAt = now; break;
      case 'Đã huỷ': order.timestamps.canceledAt = now; break;
    }

    const updated = await order.save();
    res.json({
      message: 'Cập nhật thành công',
      order: { ...updated.toObject(), timestamps: updated.timestamps }
    });
  } catch (err) {
    console.error('[updateOrderStatus] error:', err);
    res.status(err.name === 'ValidationError' ? 400 : 500).json({ message: err.message || 'Lỗi server' });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const query = req.user.isAdmin 
      ? { _id: req.params.id } 
      : { _id: req.params.id, user: req.user._id };

    const order = await Order.findOne(query);
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    if (order.status !== 'Chờ xác nhận') return res.status(400).json({ message: 'Chỉ hủy được đơn chưa xử lý' });

    order.status = 'Đã huỷ';
    order.timestamps.canceledAt = new Date();
    const updated = await order.save();
    
    res.json({
      message: 'Huỷ đơn thành công',
      order: { ...updated.toObject(), timestamps: updated.timestamps }
    });
  } catch (err) {
    console.error('[cancelOrder] error:', err);
    res.status(err.name === 'CastError' ? 400 : 500).json({ message: err.message || 'Lỗi server' });
  }
};
