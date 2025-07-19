// controllers/orderController.js
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { safeNotify } = require('../utils/notificationMiddleware');
const assignOrderToNearestShipper = require('../utils/assignOrderToNearestShipper');
const { processOrderCompletionForFinance, reverseFinancialEntryForOrder } = require('./financeController');
const UserVoucher = require('../models/UserVoucher');
const Voucher = require('../models/Voucher');
const mongoose = require('mongoose');

// Hàm kiểm tra giờ bán
const validateSaleTime = (product, nowMin) => {
    if (!product.saleStartTime || !product.saleEndTime) return true;
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

exports.createOrder = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const {
            items, total, phone, shippingAddress, shippingLocation, customerName,
            paymentMethod, shippingFee, extraSurcharge, voucherDiscount, voucherCode
        } = req.body;
        const userId = req.user._id;

        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('Giỏ hàng không được để trống');
        }
        if (!phone || !shippingAddress || !shippingLocation) {
            throw new Error('Thiếu thông tin nhận hàng');
        }

        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const enrichedItems = [];

        for (const item of items) {
            const product = await Product.findById(item.productId).populate('seller').session(session);
            if (!product) throw new Error(`Sản phẩm "${item.name}" không còn tồn tại.`);
            if (!product.seller) throw new Error(`Sản phẩm "${product.name}" không có thông tin người bán.`);
            if (!validateSaleTime(product, nowMin)) {
                throw new Error(`Sản phẩm "${product.name}" chỉ bán từ ${product.saleStartTime} đến ${product.saleEndTime}.`);
            }

            let stock;
            if (product.variantTable && product.variantTable.length > 0) {
                const variant = product.variantTable.find(v => v.combination === item.combination);
                if (!variant) throw new Error(`Biến thể của sản phẩm "${item.name}" không tồn tại.`);
                stock = variant.stock;
            } else {
                stock = product.stock;
            }
            if (stock < item.quantity) {
                throw new Error(`Sản phẩm "${product.name}" không đủ hàng trong kho.`);
            }

            const itemTotal = item.price * item.quantity;
            const commissionRate = product.seller.commissionRate || 0;
            const commissionAmount = itemTotal * (commissionRate / 100);
            
            enrichedItems.push({
                ...item,
                sellerId: product.seller._id,
                commissionAmount: commissionAmount,
            });

            if (product.variantTable && product.variantTable.length > 0) {
                const variantIndex = product.variantTable.findIndex(v => v.combination === item.combination);
                product.variantTable[variantIndex].stock -= item.quantity;
            } else {
                product.stock -= item.quantity;
            }
            await product.save({ session });
        }

        if (voucherCode && voucherDiscount > 0) {
            const voucher = await Voucher.findOne({ code: voucherCode.toUpperCase() }).session(session);
            if (!voucher) {
                throw new Error(`Mã voucher "${voucherCode}" không tồn tại.`);
            }

            const userVoucher = await UserVoucher.findOne({
                user: userId,
                voucher: voucher._id,
                isUsed: false
            }).session(session);

            if (!userVoucher) {
                throw new Error(`Bạn không sở hữu voucher "${voucherCode}" hoặc đã sử dụng nó.`);
            }

            userVoucher.isUsed = true;
            await userVoucher.save({ session });
        }

        const order = new Order({
            user: userId,
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
        
        const [savedOrder] = await Order.create([order], { session });

        await session.commitTransaction();

        assignOrderToNearestShipper(savedOrder._id).catch(console.error);
        notifyAdmins(savedOrder);

        return res.status(201).json({
            message: 'Tạo đơn thành công',
            order: { ...savedOrder.toObject(), timestamps: savedOrder.timestamps }
        });

    } catch (err) {
        await session.abortTransaction();
        console.error('Lỗi khi tạo đơn hàng:', err);
        const statusCode = err.message.includes('tồn tại') || err.message.includes('đủ hàng') || err.message.includes('voucher') ? 400 : 500;
        return res.status(statusCode).json({ message: err.message || 'Lỗi server' });
    } finally {
        session.endSession();
    }
};

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

    order.status = 'Đang xử lý';
    order.shipper = shipper._id;
    order.timestamps.acceptedAt = new Date();

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

    const customer = await User.findById(order.user);
    if (customer?.fcmToken) {
        await safeNotify(customer.fcmToken, {
            title: 'Shipper đã nhận đơn của bạn!',
            body: `Đơn hàng #${order._id.toString().slice(-6)} đang được chuẩn bị.`,
            data: { orderId: order._id.toString(), type: 'order_update' }
        });
    }

    const sellerIds = [...new Set(order.items.map(item => item.sellerId.toString()))];
    const sellers = await User.find({
        _id: { $in: sellerIds },
        fcmToken: { $exists: true, $ne: null }
    }).select('fcmToken');

    for (const seller of sellers) {
        await safeNotify(seller.fcmToken, {
            title: 'Shipper đã nhận đơn hàng!',
            body: `Đơn hàng #${order._id.toString().slice(-6)} đã có shipper nhận. Vui lòng chuẩn bị hàng.`,
            data: { orderId: order._id.toString(), type: 'order_accepted_by_shipper' }
        });
    }
    
    res.json({ message: 'Nhận đơn thành công', order: updatedOrder });
  } catch (error) {
    console.error('Lỗi khi chấp nhận đơn hàng:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// ==========================================================
// ===   SỬA HÀM NÀY ĐỂ GHI NHẬN TIMESTAMP ĐÚNG CÁCH      ===
// ==========================================================
exports.updateOrderStatusByShipper = async (req, res) => {
    try {
        const { status, cancelReason } = req.body;
        const orderId = req.params.id;

        const order = await Order.findOne({ _id: orderId, shipper: req.user._id });

        if (!order) {
            return res.status(404).json({ message: 'Đơn hàng không tồn tại hoặc bạn không phải shipper của đơn này.' });
        }

        const validTransitions = {
            'Đang xử lý': ['Đang giao', 'Đã huỷ'],
            'Đang giao': ['Đã giao', 'Đã huỷ']
        };

        if (!validTransitions[order.status]?.includes(status)) {
            return res.status(400).json({ message: `Không thể chuyển từ trạng thái "${order.status}" sang "${status}".` });
        }

        const updatePayload = {
            status: status,
        };
        const now = new Date();

        if (status === 'Đang giao') {
            updatePayload['timestamps.deliveringAt'] = now;
        } else if (status === 'Đã giao') {
            updatePayload['timestamps.deliveredAt'] = now;
        } else if (status === 'Đã huỷ') {
            updatePayload['timestamps.canceledAt'] = now;
            updatePayload.cancelReason = cancelReason || 'Shipper đã hủy đơn';
        }

        const updatedOrder = await Order.findByIdAndUpdate(
            orderId,
            { $set: updatePayload },
            { new: true }
        );

        if (status === 'Đã giao') {
            await processOrderCompletionForFinance(updatedOrder._id);
        }

        res.json({ message: 'Cập nhật trạng thái thành công', order: updatedOrder });
    } catch (error) {
        console.error(`Lỗi khi shipper cập nhật trạng thái:`, error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getShipperOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const result = await Order.paginate({ shipper: req.user._id, ...(status && { status }) }, { page: parseInt(page), limit: parseInt(limit), sort: { 'timestamps.createdAt': -1 } });
    res.json({ orders: result.docs.map(doc => ({ ...doc.toObject(), timestamps: doc.timestamps })), totalPages: result.totalPages, currentPage: result.page, totalOrders: result.totalDocs });
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const result = await Order.paginate({ user: req.user._id, ...(status && { status }) }, { page, limit, sort: { 'timestamps.createdAt': -1 } });
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

    const counts = await Order.aggregate([
      { $match: { user: req.user._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const result = { pending: 0, confirmed: 0, shipped: 0, delivered: 0, canceled: 0 };

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
      .populate('shipper', 'name phone shipperProfile.vehicleType shipperProfile.licensePlate');

    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    let canView = false;
    const currentUserId = req.user._id;
    const currentUserRole = req.user.role;

    if (currentUserRole === 'admin') canView = true;
    else if (order.user?._id.equals(currentUserId)) canView = true;
    else if (order.shipper?._id.equals(currentUserId)) canView = true;
    else if (currentUserRole === 'shipper' && order.status === 'Chờ xác nhận') canView = true;
    else if (currentUserRole === 'seller' && order.items.some(item => item.sellerId.equals(currentUserId))) canView = true;
    
    if (canView) {
      let responseOrder = order.toObject({ virtuals: true });
      responseOrder.timestamps = order.timestamps;
      res.json(responseOrder);
    } else {
      res.status(403).json({ message: 'Bạn không có quyền truy cập đơn hàng này.' });
    }
  } catch (err) {
    console.error('[getOrderById] error:', err);
    res.status(500).json({ message: err.message || 'Lỗi server' });
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const query = status ? { status } : {};
    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: { 'timestamps.createdAt': -1 }, 
      populate: { path: 'user', select: 'name' },
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
    const { status, cancelReason } = req.body;
    if (!status) {
      return res.status(400).json({ message: 'Thiếu thông tin trạng thái mới' });
    }
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }
    const oldStatus = order.status;
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
          await processOrderCompletionForFinance(order._id);
        }
        break;
      case 'Đã huỷ':
        if (!order.timestamps.canceledAt) {
          order.timestamps.canceledAt = now;
          const reason = cancelReason || 'Admin đã hủy đơn';
          order.cancelReason = reason;
          if (oldStatus === 'Đã giao') {
            await reverseFinancialEntryForOrder(order._id, reason);
          }
        }
        break;
    }
    const updatedOrder = await order.save();
    res.json({ message: 'Cập nhật trạng thái thành công', order: updatedOrder });
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
    const counts = await Order.aggregate([ { $group: { _id: '$status', count: { $sum: 1 } } } ]);
    const result = { 'pending': 0, 'confirmed': 0, 'shipped': 0, 'delivered': 0, 'canceled': 0 };
    counts.forEach(item => {
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

exports.requestOrderTransfer = async (req, res) => {
    // <<< SỬA LỖI TẠI ĐÂY: Đọc đúng tham số 'id' từ route >>>
    const { id: orderId } = req.params; // Đổi từ orderId thành id
    const shipperId = req.user._id;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const order = await Order.findById(orderId).session(session);

        if (!order) {
            throw new Error('Đơn hàng không tồn tại.');
        }
        if (!order.shipper || order.shipper.toString() !== shipperId.toString()) {
            throw new Error('Bạn không phải shipper của đơn hàng này.');
        }
        if (!['Đang xử lý', 'Đang giao'].includes(order.status)) {
            throw new Error('Chỉ có thể chuyển đơn hàng đang xử lý hoặc đang giao.');
        }

        order.shipper = null;
        order.status = 'Chờ xác nhận';
        order.shipperIncome = 0;
        order.timestamps.acceptedAt = null;
        order.timestamps.deliveringAt = null;

        await order.save({ session });
        await session.commitTransaction();

        assignOrderToNearestShipper(order._id)
            .then(() => console.log(`[Order Transfer] Đã chuyển đơn ${order._id} và tái gán thành công.`))
            .catch(err => console.error(`[Order Transfer] Lỗi khi tái gán đơn ${order._id}:`, err));

        const customer = await User.findById(order.user);
        if (customer && customer.fcmToken) {
            await safeNotify(customer.fcmToken, {
                title: 'Thông báo đơn hàng',
                body: `Shipper cũ của bạn không thể tiếp tục giao đơn hàng #${order._id.toString().slice(-6)}. Chúng tôi đang tìm shipper mới cho bạn.`,
                data: { orderId: order._id.toString(), type: 'order_transfer_customer' }
            });
        }
        
        const admins = await User.find({ role: 'admin', fcmToken: { $exists: true } });
        for (const admin of admins) {
            await safeNotify(admin.fcmToken, {
                title: 'Chuyển đơn hàng',
                body: `Shipper ${req.user.name} đã yêu cầu chuyển đơn hàng #${order._id.toString().slice(-6)}.`,
                data: { orderId: order._id.toString(), type: 'order_transfer_admin' }
            });
        }

        res.status(200).json({ message: 'Yêu cầu chuyển đơn thành công. Đơn hàng đang được tìm shipper mới.' });

    } catch (error) {
        await session.abortTransaction();
        console.error('[requestOrderTransfer] Lỗi:', error);
        res.status(500).json({ message: error.message || 'Lỗi server khi yêu cầu chuyển đơn.' });
    } finally {
        session.endSession();
    }
};
