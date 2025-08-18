// orderController.js (Đã sửa đổi)
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { safeNotify } = require('../utils/notificationMiddleware');
const assignOrderToNearestShipper = require('../utils/assignOrderToNearestShipper');
const { processOrderCompletionForFinance, reverseFinancialEntryForOrder } = require('./financeController');
const UserVoucher = require('../models/UserVoucher');
const Voucher = require('../models/Voucher');
const mongoose = require('mongoose');
const shippingController = require('./shippingController'); 
const moment = require('moment-timezone');

const validateSaleTime = (product) => {
    if (!product.saleTimeFrames || product.saleTimeFrames.length === 0) {
        return true;
    }
    const nowInVietnam = moment().tz('Asia/Ho_Chi_Minh');
    const nowMin = nowInVietnam.hours() * 60 + nowInVietnam.minutes();
    const toMin = (timeString) => {
        const [h, m] = timeString.split(':').map(Number);
        return h * 60 + m;
    };
    const isWithinAnyFrame = product.saleTimeFrames.some(frame => {
        const start = toMin(frame.start);
        const end = toMin(frame.end);
        if (start <= end) {
            return nowMin >= start && nowMin <= end;
        } else {
            return nowMin >= start || nowMin <= end;
        }
    });
    return isWithinAnyFrame;
};

const notifyAdmins = async (order) => {
    try {
        const admins = await User.find({ role: 'admin', fcmToken: { $exists: true, $ne: null } });
        for (const admin of admins) {
            await safeNotify(admin.fcmToken, {
                title: '🛒 Đơn hàng mới',
                body: `#${order._id.toString().slice(-6)} từ ${order.customerName}: ${order.total.toLocaleString()}đ`,
                data: { orderId: order._id.toString(), shipperView: "true" }
            });
        }
    } catch (e) {
        console.error(`[notify admin] error for admin:`, e);
    }
};

exports.createOrder = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    let savedOrder;

    try {
        const {
            items, phone, shippingAddress, shippingLocation, customerName,
            paymentMethod, voucherDiscount, voucherCode
        } = req.body;
        const userId = req.user._id;

        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('Giỏ hàng không được để trống');
        }
        if (!phone || !shippingAddress || !shippingLocation) {
            throw new Error('Thiếu thông tin nhận hàng');
        }
        
        // --- LOGIC MỚI: PHÂN NHÁNH ĐƠN HÀNG THƯỜNG VÀ ĐƠN TƯ VẤN ---
        const firstItemInfo = items[0];
        const productForCheck = await Product.findById(firstItemInfo.productId).populate('seller').session(session);
        if (!productForCheck) throw new Error(`Sản phẩm không còn tồn tại.`);
        
        if (productForCheck.requiresConsultation) {
            // Đây là đơn hàng tư vấn
            const consultationOrder = new Order({
                user: userId,
                items: [{ 
                    productId: productForCheck._id, 
                    name: `Yêu cầu tư vấn: ${productForCheck.name}`, 
                    price: 0,
                    quantity: 1, 
                    sellerId: productForCheck.seller._id 
                }],
                total: 0,
                status: 'Chờ xác nhận', // Trạng thái ban đầu để shipper nhận
                isConsultationOrder: true,
                consultationSellerId: productForCheck.seller._id,
                customerName, phone, shippingAddress, shippingLocation,
            });

            savedOrder = await consultationOrder.save({ session });
            await session.commitTransaction();
            
            res.status(201).json({ 
                message: 'Yêu cầu của bạn đã được tạo và đang tìm shipper.', 
                order: savedOrder,
            });

        } else {
            // Đây là đơn hàng thường, xử lý như cũ
            const enrichedItems = [];
            let itemsTotal = 0;

            for (const item of items) {
                const product = await Product.findById(item.productId).populate('seller').session(session);
                if (!product) throw new Error(`Sản phẩm "${item.name}" không còn tồn tại.`);
                if (!product.seller) throw new Error(`Sản phẩm "${product.name}" không có thông tin người bán.`);
                if (!validateSaleTime(product)) {
                    const timeFramesString = product.saleTimeFrames.map(f => `${f.start}-${f.end}`).join(', ');
                    throw new Error(`Sản phẩm "${product.name}" chỉ bán trong khung giờ: ${timeFramesString}.`);
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
                const itemValue = item.price * item.quantity;
                itemsTotal += itemValue;
                const commissionRate = product.seller.commissionRate || 0;
                const commissionAmount = itemValue * (commissionRate / 100);
                enrichedItems.push({ ...item, sellerId: product.seller._id, commissionAmount: commissionAmount });
                if (product.variantTable && product.variantTable.length > 0) {
                    const variantIndex = product.variantTable.findIndex(v => v.combination === item.combination);
                    product.variantTable[variantIndex].stock -= item.quantity;
                } else {
                    product.stock -= item.quantity;
                }
                await product.save({ session });
            }
            
            const { shippingFeeActual, shippingFeeCustomerPaid } = await shippingController.calculateFeeForOrder(shippingLocation, itemsTotal);
            const finalTotal = itemsTotal + shippingFeeCustomerPaid - (voucherDiscount || 0);

            if (voucherCode && voucherDiscount > 0) {
                const voucher = await Voucher.findOne({ code: voucherCode.toUpperCase() }).session(session);
                if (!voucher) throw new Error(`Mã voucher "${voucherCode}" không tồn tại.`);
                const userVoucher = await UserVoucher.findOne({ user: userId, voucher: voucher._id, isUsed: false }).session(session);
                if (!userVoucher) throw new Error(`Bạn không sở hữu voucher "${voucherCode}" hoặc đã sử dụng nó.`);
                userVoucher.isUsed = true;
                await userVoucher.save({ session });
            }

            const order = new Order({
                user: userId, items: enrichedItems, total: finalTotal, customerName, phone, shippingAddress,
                shippingLocation, paymentMethod: paymentMethod || 'COD', shippingFeeActual: shippingFeeActual,
                shippingFeeCustomerPaid: shippingFeeCustomerPaid, extraSurcharge: 0,
                voucherDiscount: voucherDiscount || 0, voucherCode, status: 'Chờ xác nhận',
                isConsultationOrder: false,
            });
            
            const [createdOrder] = await Order.create([order], { session });
            savedOrder = createdOrder;
            await session.commitTransaction();
            res.status(201).json({ message: 'Tạo đơn thành công', order: { ...savedOrder.toObject(), timestamps: savedOrder.timestamps } });
        }
    } catch (err) {
        await session.abortTransaction();
        console.error('Lỗi khi tạo đơn hàng:', err);
        if (!res.headersSent) {
            const statusCode = err.message.includes('tồn tại') || err.message.includes('đủ hàng') || err.message.includes('voucher') ? 400 : 500;
            return res.status(statusCode).json({ message: err.message || 'Lỗi server' });
        }
    } finally {
        session.endSession();
    }

    if (savedOrder) {
        console.log(`[createOrder] Bắt đầu tác vụ nền cho đơn hàng #${savedOrder._id}.`);
        Promise.all([
            assignOrderToNearestShipper(savedOrder._id),
            notifyAdmins(savedOrder)
        ]).catch(err => {
            console.error(`[createOrder] Lỗi trong tác vụ nền cho đơn hàng #${savedOrder._id}:`, err);
        });
    }
};

exports.acceptOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'name fcmToken').populate('consultationSellerId', 'name fcmToken');
    if (!order) {
      return res.status(404).json({ message: 'Đơn hàng không tồn tại' });
    }
    if (order.status !== 'Chờ xác nhận') {
      return res.status(400).json({ message: 'Đơn không khả dụng' });
    }
    const shipper = await User.findById(req.user._id);
    if (!shipper || shipper.role !== 'shipper') {
      return res.status(403).json({ message: 'Tài khoản không phải là shipper.' });
    }
    
    // --- LOGIC MỚI: PHÂN NHÁNH CHO ĐƠN TƯ VẤN VÀ ĐƠN THƯỜNG ---
    if (order.isConsultationOrder) {
        order.status = 'Đang tư vấn';
        order.shipper = shipper._id;
        order.timestamps.acceptedAt = new Date();
        const updatedOrder = await order.save();
        
        // Thông báo cho khách hàng
        if (order.user && order.user.fcmToken) {
            safeNotify(order.user.fcmToken, { 
                title: "Bắt đầu tư vấn", 
                body: `Shipper đã nhận yêu cầu. Bạn có thể bắt đầu trò chuyện với ${order.consultationSellerId.name}.` 
            });
        }
        await Notification.create({ 
            user: order.user._id, 
            title: "Bắt đầu tư vấn", 
            message: `Shipper đã nhận yêu cầu. Bạn có thể bắt đầu trò chuyện với ${order.consultationSellerId.name}.`, 
            type: 'order', 
            data: { orderId: order._id.toString() } 
        });

        // Thông báo cho seller
        if (order.consultationSellerId && order.consultationSellerId.fcmToken) {
            safeNotify(order.consultationSellerId.fcmToken, { 
                title: "Khách hàng cần tư vấn", 
                body: `Khách hàng ${order.user.name} đang chờ bạn tư vấn cho đơn hàng #${order._id.toString().slice(-6)}.` 
            });
        }
        await Notification.create({ 
            user: order.consultationSellerId._id, 
            title: "Khách hàng cần tư vấn", 
            message: `Khách hàng ${order.user.name} đang chờ bạn tư vấn cho đơn hàng #${order._id.toString().slice(-6)}.`, 
            type: 'order', 
            data: { orderId: order._id.toString() } 
        });

        res.json({ message: "Nhận yêu cầu tư vấn thành công.", order: updatedOrder });

    } else {
        // Logic cho đơn hàng thường (giữ nguyên như cũ)
        order.status = 'Đang xử lý';
        order.shipper = shipper._id;
        order.timestamps.acceptedAt = new Date();
        const shareRate = (shipper.shipperProfile.shippingFeeShareRate || 0) / 100;
        const totalActualShippingFee = (order.shippingFeeActual || 0) + (order.extraSurcharge || 0);
        const totalCommission = order.items.reduce((sum, item) => sum + (item.commissionAmount || 0), 0);
        const profitShareRate = (shipper.shipperProfile.profitShareRate || 0) / 100;
        order.shipperIncome = (totalActualShippingFee * shareRate) + (totalCommission * profitShareRate);
        order.financialDetails = {
            shippingFeeActual: order.shippingFeeActual,
            shippingFeeCustomerPaid: order.shippingFeeCustomerPaid,
            extraSurcharge: order.extraSurcharge,
            shippingFeeShareRate: shipper.shipperProfile.shippingFeeShareRate,
            profitShareRate: shipper.shipperProfile.profitShareRate
        };
        const updatedOrder = await order.save();
        if (order.user) { 
            const title = 'Shipper đã nhận đơn của bạn!';
            const message = `Đơn hàng #${order._id.toString().slice(-6)} đang được chuẩn bị.`;
            if (order.user.fcmToken) {
                await safeNotify(order.user.fcmToken, { title, body: message, data: { orderId: order._id.toString(), type: 'order_update' } });
            }
            await Notification.create({ user: order.user._id, title, message, type: 'order', data: { orderId: order._id.toString() } });
        }
        const sellerIds = [...new Set(order.items.map(item => item.sellerId.toString()))];
        const sellers = await User.find({ _id: { $in: sellerIds } }).select('fcmToken');
        const notificationTitle = 'Đơn hàng đã có tài xế!';
        const notificationBody = `Đơn hàng #${order._id.toString().slice(-6)} đã có tài xế nhận. Vui lòng chuẩn bị hàng.`;
        for (const seller of sellers) {
            await Notification.create({ user: seller._id, title: notificationTitle, message: notificationBody, type: 'order_accepted_by_shipper', data: { orderId: order._id.toString(), screen: 'OrderDetail' } });
            if (seller.fcmToken) {
                await safeNotify(seller.fcmToken, { title: notificationTitle, body: notificationBody, data: { orderId: order._id.toString(), type: 'order_accepted_by_shipper', screen: 'OrderDetail' } });
            }
        }
        res.json({ message: 'Nhận đơn thành công', order: updatedOrder });
    }
  } catch (error) {
    console.error('Lỗi khi chấp nhận đơn hàng:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};


// =================================================================
// === CÁC HÀM KHÁC CỦA BẠN ĐƯỢC GIỮ NGUYÊN HOÀN TOÀN BÊN DƯỚI ===
// =================================================================

exports.countByStatus = async (req, res) => {
  try {
    const counts = await Order.aggregate([ { $group: { _id: '$status', count: { $sum: 1 } } } ]).exec();
    const result = counts.reduce((acc, item) => { acc[item._id] = item.count; return acc; }, {});
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server', error: error.message });
  }
};


exports.updateOrderStatusByShipper = async (req, res) => {
    try {
        const { status, cancelReason } = req.body;
        const orderId = req.params.id;

        const order = await Order.findOne({ _id: orderId, shipper: req.user._id }).populate('user', 'fcmToken');

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

        const now = new Date();
        order.status = status;

        if (status === 'Đang giao') {
            order.timestamps.deliveringAt = now;
        } else if (status === 'Đã giao') {
            order.timestamps.deliveredAt = now;
        } else if (status === 'Đã huỷ') {
            order.timestamps.canceledAt = now;
            order.cancelReason = cancelReason || 'Shipper đã hủy đơn';
        }

        const updatedOrder = await order.save();
        
        if (order.user) {
            let title = '';
            let message = '';

            switch(status) {
                case 'Đang giao':
                    title = 'Đơn hàng đang được giao!';
                    message = `Shipper đang trên đường giao đơn hàng #${updatedOrder._id.toString().slice(-6)} đến cho bạn.`;
                    break;
                case 'Đã giao':
                    title = 'Giao hàng thành công!';
                    message = `Đơn hàng #${updatedOrder._id.toString().slice(-6)} đã được giao thành công. Cảm ơn bạn đã mua hàng!`;
                    break;
                case 'Đã huỷ':
                    title = 'Đơn hàng đã bị hủy';
                    message = `Đơn hàng #${updatedOrder._id.toString().slice(-6)} đã bị hủy. Lý do: ${updatedOrder.cancelReason}`;
                    break;
            }

            if (title) {
                if (order.user.fcmToken) {
                    await safeNotify(order.user.fcmToken, {
                        title,
                        body: message,
                        data: { orderId: updatedOrder._id.toString(), type: 'order_update' }
                    });
                }
                await Notification.create({
                    user: order.user._id,
                    title,
                    message,
                    type: 'order',
                    data: { orderId: updatedOrder._id.toString() }
                });
            }
        }
        
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
    const counts = await Order.aggregate([ { $match: { user: req.user._id } }, { $group: { _id: '$status', count: { $sum: 1 } } } ]);
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

    // Logic kiểm tra quyền truy cập của bạn đã đúng và được giữ nguyên
    let canView = false;
    const currentUserId = req.user._id;
    const currentUserRole = req.user.role;
    if (currentUserRole === 'admin') canView = true;
    else if (order.user?._id.equals(currentUserId)) canView = true;
    else if (order.shipper?._id.equals(currentUserId)) canView = true;
    else if (currentUserRole === 'shipper' && order.status === 'Chờ xác nhận') canView = true;
    else if (currentUserRole === 'seller' && order.items.some(item => item.sellerId.equals(currentUserId))) canView = true;
    
    if (canView) {
      // <<< BẮT ĐẦU SỬA LỖI TẠI ĐÂY >>>
      // Chuyển order Mongoose document thành một object JavaScript thông thường
      let responseOrder = order.toObject({ virtuals: true });
      
      // Gán lại các trường timestamp (vì .toObject() có thể không giữ đúng định dạng)
      responseOrder.timestamps = order.timestamps;
      
      // Thêm một trường 'shippingFee' vào object trả về để tương thích với client
      // mà không cần sửa code client.
      // Giá trị của nó là phí mà khách hàng trả (hoặc phí thực tế nếu khách trả = 0).
      responseOrder.shippingFee = order.shippingFeeCustomerPaid || order.shippingFeeActual || 0;
      
      // Trả về object đã được tùy chỉnh
      res.json(responseOrder);
      // <<< KẾT THÚC SỬA LỖI >>>
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
    const options = { page: parseInt(page, 10), limit: parseInt(limit, 10), sort: { 'timestamps.createdAt': -1 }, populate: { path: 'user', select: 'name' }, };
    const result = await Order.paginate(query, options);
    res.json({ docs: result.docs.map(doc => ({ ...doc.toObject(), timestamps: doc.timestamps })), totalPages: result.totalPages, page: result.page });
  } catch (err) {
    console.error('[getAllOrders] error:', err);
    res.status(500).json({ message: 'Lỗi server khi lấy tất cả đơn hàng' });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, cancelReason } = req.body;
    if (!status) return res.status(400).json({ message: 'Thiếu thông tin trạng thái mới' });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    const oldStatus = order.status;
    order.status = status;
    const now = new Date();
    switch (status) {
      case 'Đang xử lý': if (!order.timestamps.acceptedAt) order.timestamps.acceptedAt = now; break;
      case 'Đang giao': if (!order.timestamps.deliveringAt) order.timestamps.deliveringAt = now; break;
      case 'Đã giao': if (!order.timestamps.deliveredAt) { order.timestamps.deliveredAt = now; await processOrderCompletionForFinance(order._id); } break;
      case 'Đã huỷ': if (!order.timestamps.canceledAt) { order.timestamps.canceledAt = now; const reason = cancelReason || 'Admin đã hủy đơn'; order.cancelReason = reason; if (oldStatus === 'Đã giao') { await reverseFinancialEntryForOrder(order._id, reason); } } break;
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
    const { id: orderId } = req.params;
    const shipperId = req.user._id;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const order = await Order.findById(orderId).session(session);
        if (!order) throw new Error('Đơn hàng không tồn tại.');
        if (!order.shipper || order.shipper.toString() !== shipperId.toString()) throw new Error('Bạn không phải shipper của đơn hàng này.');
        if (!['Đang xử lý', 'Đang giao'].includes(order.status)) throw new Error('Chỉ có thể chuyển đơn hàng đang xử lý hoặc đang giao.');

        order.shipper = null;
        order.status = 'Chờ xác nhận';
        order.shipperIncome = 0;
        order.timestamps.acceptedAt = null;
        order.timestamps.deliveringAt = null;

        await order.save({ session });
        await session.commitTransaction();

        assignOrderToNearestShipper(order._id).catch(err => console.error(`[Order Transfer] Lỗi khi tái gán đơn ${order._id}:`, err));

        const customer = await User.findById(order.user);
        if (customer) {
            const title = 'Thông báo đơn hàng';
            const message = `Shipper cũ của bạn không thể tiếp tục giao đơn hàng #${order._id.toString().slice(-6)}. Chúng tôi đang tìm shipper mới cho bạn.`;

            if (customer.fcmToken) {
                await safeNotify(customer.fcmToken, {
                    title,
                    body: message,
                    data: { orderId: order._id.toString(), type: 'order_transfer_customer' }
                });
            }

            await Notification.create({
                user: customer._id,
                title: title,
                message: message,
                type: 'order',
                data: { orderId: order._id.toString() }
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


exports.requestConsultation = async (req, res) => {
    try {
        const { sellerId, initialMessage } = req.body; // Cần biết seller nào để gửi yêu cầu
        const userId = req.user._id;

        // Tạo một "đơn hàng" đặc biệt với trạng thái chờ tư vấn
        const consultationOrder = new Order({
            user: userId,
            items: [], // Ban đầu chưa có sản phẩm
            total: 0,
            status: 'Chờ tư vấn',
            // Gán seller cho đơn hàng ngay từ đầu
            // Cần một cách để xác định seller, ví dụ qua một trường `consultingSeller`
            // Hoặc đơn giản là lấy seller từ sản phẩm tư vấn đầu tiên
        });
        
        // Logic tìm seller và gửi thông báo cho họ...

        res.status(201).json({ message: "Yêu cầu tư vấn đã được gửi.", order: consultationOrder });
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi tạo yêu cầu tư vấn." });
    }
};

exports.confirmPricedOrder = async (req, res) => {
    try {
        const { id: orderId } = req.params;
        const userId = req.user._id;

        const order = await Order.findOne({ _id: orderId, user: userId, status: 'Chờ khách xác nhận' });
        if (!order) {
            return res.status(404).json({ message: "Đơn hàng không hợp lệ hoặc không tìm thấy." });
        }

        order.status = 'Chờ xác nhận'; // Chuyển về luồng bình thường
        await order.save();
        
        // Bắt đầu quá trình tìm shipper
        assignOrderToNearestShipper(order._id);
        notifyAdmins(order);

        res.status(200).json({ message: "Đã xác nhận đơn hàng thành công!", order });
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi xác nhận đơn hàng." });
    }
};
