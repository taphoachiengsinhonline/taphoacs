// controllers/orderController.js

const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { safeNotify } = require('../utils/notificationMiddleware');
const assignOrderToNearestShipper = require('../utils/assignOrderToNearestShipper');

// Hàm kiểm tra giờ bán
const validateSaleTime = (product, nowMin) => {
    if (!product.saleStartTime || !product.saleEndTime) return true; // Bán 24/7 nếu không có giờ
    const toMin = str => {
        const [h, m] = str.split(':').map(Number);
        return h * 60 + m;
    };
    const start = toMin(product.saleStartTime);
    const end = toMin(product.saleEndTime);
    return start <= end ? (nowMin >= start && nowMin <= end) : (nowMin >= start || nowMin <= end);
};

// Hàm gửi thông báo cho Admin
const notifyAdmins = async (order) => {
    const admins = await User.find({ role: 'admin', fcmToken: { $exists: true } });
    for (const admin of admins) {
        try {
            await safeNotify(admin.fcmToken, {
                title: '🛒 Đơn hàng mới',
                body: `#${order._id.toString().slice(-6)} từ ${order.customerName}: ${order.total.toLocaleString()}đ`,
                data: { orderId: order._id.toString(), shipperView: "true" }
            });
        } catch (e) {
            console.error(`[notify admin] error for admin ${admin._id}:`, e);
        }
    }
};

// ==============================================================================
// ===                      HÀM CREATE ORDER - PHIÊN BẢN HOÀN CHỈNH          ===
// ==============================================================================
exports.createOrder = async (req, res) => {
  try {
    const {
      items, total, phone, shippingAddress, shippingLocation, customerName,
      paymentMethod, shippingFee, extraSurcharge, voucherDiscount, voucherCode
    } = req.body;

    // --- 1. Validation cơ bản ---
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ message: 'Giỏ hàng không được để trống' });
    if (!phone || !shippingAddress || !shippingLocation) return res.status(400).json({ message: 'Thiếu thông tin nhận hàng' });

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const enrichedItems = []; // Mảng chứa các item đã được "làm giàu" thông tin

    // --- 2. Xử lý và làm giàu thông tin cho từng item ---
    for (const item of items) {
      const product = await Product.findById(item.productId).populate('seller');
      if (!product) throw new Error(`Sản phẩm "${item.name}" không còn tồn tại.`);
      if (!product.seller) throw new Error(`Sản phẩm "${product.name}" không có thông tin người bán.`);

      if (!validateSaleTime(product, nowMin)) {
        throw new Error(`Sản phẩm "${product.name}" chỉ bán từ ${product.saleStartTime} đến ${product.saleEndTime}.`);
      }

      // Xác định tồn kho của sản phẩm/biến thể
      let stock;
      if (product.variantTable && product.variantTable.length > 0) {
          const variant = product.variantTable.find(v => v.combination === item.combination);
          stock = variant ? variant.stock : 0;
      } else {
          stock = product.stock;
      }
      if (stock < item.quantity) {
        throw new Error(`Sản phẩm "${product.name}" không đủ hàng trong kho.`);
      }

      // <<< LOGIC MỚI: TÍNH PHÍ SÀN (COMMISSION) >>>
      const itemTotal = item.price * item.quantity;
      const commissionRate = product.seller.commissionRate || 0;
      const commissionAmount = itemTotal * (commissionRate / 100);
      
      enrichedItems.push({
        ...item,
        sellerId: product.seller._id,
        commissionAmount: commissionAmount, // <-- Lưu lại tiền phí sàn
      });

      // Trừ kho
      if (product.variantTable && product.variantTable.length > 0) {
        const variantIndex = product.variantTable.findIndex(v => v.combination === item.combination);
        if (variantIndex > -1) {
            product.variantTable[variantIndex].stock -= item.quantity;
        }
      } else {
        product.stock -= item.quantity;
      }
      await product.save();
    }

    // --- 3. Tạo đơn hàng với thông tin đã được làm giàu ---
    const order = new Order({
      user: req.user._id,
      items: enrichedItems,
      total,
      customerName,
      phone,
      shippingAddress,
      shippingLocation,
      paymentMethod: paymentMethod || 'COD',
      shippingFee,
      extraSurcharge,
      voucherDiscount,
      voucherCode,
      status: 'Chờ xác nhận',
    });

    const savedOrder = await order.save();
    
    assignOrderToNearestShipper(savedOrder._id).catch(console.error);
    notifyAdmins(savedOrder);

    return res.status(201).json({
      message: 'Tạo đơn thành công',
      order: { ...savedOrder.toObject(), timestamps: savedOrder.timestamps }
    });

  } catch (err) {
    console.error('Lỗi khi tạo đơn hàng:', err);
    const statusCode = err.name === 'ValidationError' ? 400 : (err.message.includes('tồn tại') || err.message.includes('đủ hàng')) ? 400 : 500;
    return res.status(statusCode).json({ message: err.message || 'Lỗi server' });
  }
};


// ==============================================================================
// ===                      CÁC HÀM KHÁC GIỮ NGUYÊN                             ===
// ==============================================================================

exports.countByStatus = async (req, res) => {
  try {
    const counts = await Order.aggregate([ { $group: { _id: '$status', count: { $sum: 1 } } } ]).exec();
    const result = counts.reduce((acc, item) => { acc[item._id] = item.count; return acc; }, {});
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server', error: error.message });
  }
};

exports.acceptOrder = async (req, res) => {
  try {
    // ... (các bước kiểm tra order và shipper giữ nguyên)
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Đơn hàng không tồn tại' });
    if (order.status !== 'Chờ xác nhận') return res.status(400).json({ message: 'Đơn không khả dụng' });

    const shipper = await User.findById(req.user._id);
    if (!shipper || shipper.role !== 'shipper') {
        return res.status(403).json({ message: 'Tài khoản không phải là shipper.' });
    }

    order.status = 'Đang xử lý';
    order.shipper = shipper._id;
    order.timestamps.acceptedAt = new Date();

    // <<< LOGIC TÍNH TOÁN THU NHẬP ĐẦY ĐỦ >>>
    // 1. Tính thu nhập từ phí ship
    const shippingFeeShareRate = (shipper.shipperProfile.shippingFeeShareRate || 0) / 100;
    const totalShippingFee = (order.shippingFee || 0) + (order.extraSurcharge || 0);
    const shipperShippingIncome = totalShippingFee * shippingFeeShareRate;
    
    // 2. Tính tổng phí sàn (lợi nhuận của admin từ đơn hàng này)
    const totalCommission = order.items.reduce((sum, item) => sum + (item.commissionAmount || 0), 0);
    
    // 3. Tính phần chia sẻ lợi nhuận cho shipper
    const profitShareRate = (shipper.shipperProfile.profitShareRate || 0) / 100;
    const shipperProfitShare = totalCommission * profitShareRate;

    // 4. Tổng thu nhập của shipper
    order.shipperIncome = shipperShippingIncome + shipperProfitShare;
    
    // 5. Lưu lại chi tiết tài chính tại thời điểm đó
    order.financialDetails = {
        shippingFee: order.shippingFee,
        extraSurcharge: order.extraSurcharge,
        shippingFeeShareRate: shipper.shipperProfile.shippingFeeShareRate,
        profitShareRate: shipper.shipperProfile.profitShareRate // Thêm trường này
    };
    // <<< KẾT THÚC LOGIC MỚI >>>
    
    const updated = await order.save();
    if (updated.user) {
      const customer = await User.findById(updated.user);
      if (customer?.fcmToken) await safeNotify(customer.fcmToken, { title: 'Shipper đã nhận đơn', body: `Đơn hàng #${order._id.toString().slice(-6)} đã được shipper nhận.`, data: { orderId: order._id.toString(), shipperView: "false" } });
    }
    
    res.json({ message: 'Nhận đơn thành công', order: updated });
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
    order.status = status;
    const now = new Date();
    if (status === 'Đang giao') order.timestamps.deliveringAt = now;
    if (status === 'Đã giao') order.timestamps.deliveredAt = now;
    if (status === 'Đã huỷ') { order.timestamps.canceledAt = now; order.cancelReason = cancelReason || 'Không có lý do'; }
    const updated = await order.save();
    res.json({ message: 'Cập nhật trạng thái thành công', order: updated });
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.getShipperOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const result = await Order.paginate({ shipper: req.user._id, ...(status && { status }) }, { page: parseInt(page), limit: parseInt(limit), sort: { createdAt: -1 } });
    res.json({ orders: result.docs.map(doc => ({ ...doc.toObject(), timestamps: doc.timestamps })), totalPages: result.totalPages, currentPage: result.page, totalOrders: result.totalDocs });
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const result = await Order.paginate({ user: req.user._id, ...(status && { status }) }, { page, limit, sort: { createdAt: -1 } });
    res.json({ docs: result.docs.map(doc => ({ ...doc.toObject(), timestamps: doc.timestamps })), totalPages: result.totalPages, page: result.page });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.countOrdersByStatus = async (req, res) => {
  try {
    if (!req.user || !req.user._id) return res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ' });
    const all = await Order.find({ user: req.user._id });
    const counts = all.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, { 'Chờ xác nhận': 0, 'Đang xử lý': 0, 'Đang giao': 0, 'Đã giao': 0, 'Đã huỷ': 0 });
    return res.status(200).json(counts);
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi server khi đếm đơn hàng theo trạng thái' });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'name phone').populate('shipper', 'name phone');
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    const canView = [req.user.isAdmin, order.user?._id.equals(req.user._id), order.shipper?._id.equals(req.user._id), req.query.shipperView === 'true' && order.status === 'Chờ xác nhận' && req.user.role === 'shipper'].some(Boolean);
    canView ? res.json({ ...order.toObject(), timestamps: order.timestamps }) : res.status(403).json({ message: 'Không có quyền truy cập' });
  } catch (err) {
    res.status(err.name === 'CastError' ? 400 : 500).json({ message: err.message || 'Lỗi server' });
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const result = await Order.paginate({ ...(status && { status }) }, { page, limit, sort: { createdAt: -1 }, populate: 'user' });
    res.json({ docs: result.docs.map(doc => ({ ...doc.toObject(), timestamps: doc.timestamps })), totalPages: result.totalPages, page: result.page });
  } catch (err) {
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
    if (status === 'Đang xử lý') order.timestamps.acceptedAt = now;
    if (status === 'Đang giao') order.timestamps.deliveringAt = now;
    if (status === 'Đã giao') order.timestamps.deliveredAt = now;
    if (status === 'Đã huỷ') order.timestamps.canceledAt = now;
    const updated = await order.save();
    res.json({ message: 'Cập nhật thành công', order: updated });
  } catch (err) {
    res.status(err.name === 'ValidationError' ? 400 : 500).json({ message: err.message || 'Lỗi server' });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const query = req.user.isAdmin ? { _id: req.params.id } : { _id: req.params.id, user: req.user._id };
    const order = await Order.findOne(query);
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    if (order.status !== 'Chờ xác nhận') return res.status(400).json({ message: 'Chỉ hủy được đơn chưa xử lý' });
    order.status = 'Đã huỷ';
    order.timestamps.canceledAt = new Date();
    const updated = await order.save();
    res.json({ message: 'Huỷ đơn thành công', order: updated });
  } catch (err) {
    res.status(err.name === 'CastError' ? 400 : 500).json({ message: err.message || 'Lỗi server' });
  }
};

exports.adminCountByStatus = async (req, res) => {
  try {
    const counts = await Order.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const result = {
        'pending': 0,
        'confirmed': 0,
        'shipped': 0,
        'delivered': 0,
        'canceled': 0
    };

    counts.forEach(item => {
        // Ánh xạ từ tên trạng thái trong DB sang key mà frontend mong đợi
        if (item._id === 'Chờ xác nhận') result.pending = item.count;
        if (item._id === 'Đang xử lý') result.confirmed = item.count;
        if (item._id === 'Đang giao') result.shipped = item.count;
        if (item._id === 'Đã giao') result.delivered = item.count;
        if (item._id === 'Đã huỷ') result.canceled = item.count;
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('[adminCountByStatus] Lỗi:', error);
    res.status(500).json({ message: 'Lỗi server khi đếm đơn hàng' });
  }
};
