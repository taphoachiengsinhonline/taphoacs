// controllers/orderController.js

const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { safeNotify } = require('../utils/notificationMiddleware');
const assignOrderToNearestShipper = require('../utils/assignOrderToNearestShipper');
const { processOrderCompletionForFinance } = require('./financeController');

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
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Đơn hàng không tồn tại' });
    if (order.status !== 'Chờ xác nhận') return res.status(400).json({ message: 'Đơn không khả dụng' });

    const shipper = await User.findById(req.user._id);
    if (!shipper || shipper.role !== 'shipper') {
      return res.status(403).json({ message: 'Tài khoản không phải là shipper.' });
    }

    // Gán shipper và cập nhật trạng thái
    order.status = 'Đang xử lý';
    order.shipper = shipper._id;
    order.timestamps.acceptedAt = new Date();

    // Tính toán và lưu thu nhập cho shipper (giữ nguyên logic đã sửa)
    const shareRate = (shipper.shipperProfile.shippingFeeShareRate || 0) / 100;
    const totalShippingFee = (order.shippingFee || 0) + (order.extraSurcharge || 0);
    const totalCommission = order.items.reduce((sum, item) => sum + (item.commissionAmount || 0), 0);
    const profitShareRate = (shipper.shipperProfile.profitShareRate || 0) / 100;
    order.shipperIncome = (totalShippingFee * shareRate) + (totalCommission * profitShareRate);
    order.financialDetails = {
        shippingFee: order.shippingFee,
        extraSurcharge: order.extraSurcharge,
        shippingFeeShareRate: shipper.shipperProfile.shippingFeeShareRate,
        profitShareRate: shipper.shipperProfile.profitShareRate
    };
    
    const updatedOrder = await order.save();

    // <<< LOGIC MỚI: GỬI THÔNG BÁO CHO SELLER VÀ CUSTOMER >>>

    // 1. Gửi thông báo cho khách hàng (Customer)
    const customer = await User.findById(order.user);
    if (customer?.fcmToken) {
        await safeNotify(customer.fcmToken, {
            title: 'Shipper đã nhận đơn của bạn!',
            body: `Đơn hàng #${order._id.toString().slice(-6)} đang được chuẩn bị.`,
            data: { orderId: order._id.toString(), type: 'order_update' }
        });
    }

    // 2. Tìm tất cả các seller có sản phẩm trong đơn hàng
    const sellerIds = [...new Set(order.items.map(item => item.sellerId.toString()))];
    const sellers = await User.find({
        _id: { $in: sellerIds },
        fcmToken: { $exists: true, $ne: null }
    }).select('fcmToken');

    // 3. Gửi thông báo cho từng seller
    for (const seller of sellers) {
        await safeNotify(seller.fcmToken, {
            title: 'Shipper đã nhận đơn hàng!',
            body: `Đơn hàng #${order._id.toString().slice(-6)} đã có shipper nhận. Vui lòng chuẩn bị hàng.`,
            data: { orderId: order._id.toString(), type: 'order_accepted_by_shipper' }
        });
    }
    // <<< KẾT THÚC LOGIC MỚI >>>
    
    res.json({ message: 'Nhận đơn thành công', order: updatedOrder });
  } catch (error) {
    console.error('Lỗi khi chấp nhận đơn hàng:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.updateOrderStatusByShipper = async (req, res) => {
  try {
    const { status, cancelReason } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Đơn hàng không tồn tại' });
    if (!order.shipper || order.shipper.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Không có quyền thao tác' });

    const validTransitions = {
      'Đang xử lý': ['Đang giao', 'Đã huỷ'],
      'Đang giao': ['Đã giao', 'Đã huỷ']
    };
    if (!validTransitions[order.status]?.includes(status)) {
      return res.status(400).json({ message: `Không thể chuyển từ "${order.status}" sang "${status}"` });
    }

    order.status = status;
    const now = new Date();

    if (status === 'Đang giao') {
        order.timestamps.deliveringAt = now;
    }
    
    // <<< LOGIC ĐÚNG: CHỈ GỌI KHI TRẠNG THÁI LÀ "ĐÃ GIAO" >>>
    if (status === 'Đã giao') {
        order.timestamps.deliveredAt = now;
        // Gọi hàm xử lý tài chính ngay sau khi xác nhận đã giao
        await processOrderCompletionForFinance(order._id);
    }
    
    if (status === 'Đã huỷ') {
        order.timestamps.canceledAt = now;
        order.cancelReason = cancelReason || 'Shipper đã hủy đơn';
    }

    const updated = await order.save();
    res.json({ message: 'Cập nhật trạng thái thành công', order: updated });
  } catch (error) {
    console.error(`Lỗi khi shipper cập nhật trạng thái:`, error);
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
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ' });
    }

    // Sử dụng aggregate để tối ưu và chính xác hơn
    const counts = await Order.aggregate([
      { $match: { user: req.user._id } }, // Chỉ tìm đơn của user đang đăng nhập
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Chuyển đổi kết quả về đúng định dạng mà frontend mong đợi
    const result = {
        pending: 0,
        confirmed: 0,
        shipped: 0,
        delivered: 0,
        canceled: 0
    };

    counts.forEach(item => {
        if (item._id === 'Chờ xác nhận') result.pending = item.count;
        if (item._id === 'Đang xử lý') result.confirmed = item.count;
        if (item._id === 'Đang giao') result.shipped = item.count;
        if (item._id === 'Đã giao') result.delivered = item.count;
        if (item._id === 'Đã huỷ') result.canceled = item.count;
    });

    res.status(200).json(result);

  } catch (err) {
    console.error('[countOrdersByStatus] Lỗi:', err);
    return res.status(500).json({ message: 'Lỗi server khi đếm đơn hàng' });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name phone')
      .populate('shipper', 'name phone');

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    // <<< LOGIC KIỂM TRA QUYỀN ĐƯỢC NÂNG CẤP >>>
    let canView = false;
    const currentUserId = req.user._id;
    const currentUserRole = req.user.role;

    // 1. Admin có toàn quyền
    if (currentUserRole === 'admin') {
        canView = true;
    }
    // 2. Khách hàng (người đặt) có quyền xem đơn của mình
    else if (order.user?._id.equals(currentUserId)) {
        canView = true;
    }
    // 3. Shipper được gán có quyền xem đơn của mình
    else if (order.shipper?._id.equals(currentUserId)) {
        canView = true;
    }
    // 4. Shipper có thể xem đơn đang chờ (để quyết định nhận)
    else if (currentUserRole === 'shipper' && order.status === 'Chờ xác nhận' && req.query.shipperView === 'true') {
        canView = true;
    }
    // 5. Seller có quyền xem nếu đơn hàng chứa ít nhất một sản phẩm của họ
    else if (currentUserRole === 'seller') {
        const isSellerInOrder = order.items.some(item => item.sellerId.equals(currentUserId));
        if (isSellerInOrder) {
            canView = true;
        }
    }
    // <<< KẾT THÚC LOGIC KIỂM TRA QUYỀN >>>

    if (canView) {
      // Khi trả về cho Seller, có thể lọc bớt thông tin không cần thiết nếu muốn
      // Ví dụ: không cho seller thấy thông tin của shipper
      let responseOrder = order.toObject({ virtuals: true });
      responseOrder.timestamps = order.timestamps;

      if (currentUserRole === 'seller' && responseOrder.shipper) {
          // Xóa thông tin shipper khỏi response cho seller
          delete responseOrder.shipper;
      }
      
      res.json(responseOrder);
    } else {
      res.status(403).json({ message: 'Bạn không có quyền truy cập đơn hàng này.' });
    }

  } catch (err) {
    console.error('[getOrderById] error:', err);
    res.status(err.name === 'CastError' ? 400 : 500).json({ message: err.message || 'Lỗi server' });
  }
};
exports.getAllOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const query = status ? { status } : {};

    // <<< SỬA ĐỔI: Thêm `sort` để sắp xếp đơn hàng mới nhất lên đầu >>>
    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: { 'timestamps.createdAt': -1 }, 
      populate: {
        path: 'user',
        select: 'name' // Chỉ lấy tên user cho gọn
      },
    };

    const result = await Order.paginate(query, options);
    
    res.json({
      docs: result.docs.map(doc => ({ ...doc.toObject(), timestamps: doc.timestamps })),
      totalPages: result.totalPages,
      page: result.page
    });
  } catch (err) {
    console.error('[getAllOrders] error:', err);
    res.status(500).json({ message: 'Lỗi server khi lấy tất cả đơn hàng' });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ message: 'Thiếu thông tin trạng thái mới' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    order.status = status;
    const now = new Date();

    switch (status) {
      case 'Đang xử lý':
        if (!order.timestamps.acceptedAt) order.timestamps.acceptedAt = now;
        break;
      case 'Đang giao':
        if (!order.timestamps.deliveringAt) order.timestamps.deliveringAt = now;
        break;
      case 'Đã giao':
        if (!order.timestamps.deliveredAt) {
          order.timestamps.deliveredAt = now;
          // <<< GỌI HÀM XỬ LÝ TÀI CHÍNH TẠI ĐÂY >>>
          await processOrderCompletionForFinance(order._id);
        }
        break;
      case 'Đã huỷ':
        if (!order.timestamps.canceledAt) {
          order.timestamps.canceledAt = now;
          order.cancelReason = req.body.cancelReason || 'Admin đã hủy đơn';
        }
        break;
    }

    const updatedOrder = await order.save();
    
    res.json({
      message: 'Cập nhật trạng thái thành công',
      order: updatedOrder
    });

  } catch (err) {
    console.error('[updateOrderStatus by Admin] error:', err);
    res.status(500).json({ message: err.message || 'Lỗi server khi cập nhật trạng thái' });
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
