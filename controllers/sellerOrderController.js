const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { safeNotify } = require('../utils/notificationMiddleware');

// Seller lấy danh sách yêu cầu tư vấn
exports.getConsultationRequests = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const requests = await Order.find({ 
            'items.sellerId': sellerId, // Tìm các đơn có sản phẩm của seller
            status: { $in: ['Chờ tư vấn', 'Đang tư vấn'] }
        }).populate('user', 'name phone').sort('-createdAt');
        res.json(requests);
    } catch (error) {
        res.status(500).json({ message: "Lỗi tải yêu cầu tư vấn." });
    }
};

// Seller cập nhật và báo giá
exports.priceAndUpdateOrder = async (req, res) => {
    try {
        const { id: orderId } = req.params;
        const { items, sellerNotes } = req.body;
        const sellerId = req.user._id;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: "Báo giá phải có ít nhất một sản phẩm." });
        }

        const order = await Order.findById(orderId);

        if (!order || !order.isConsultationOrder) {
            return res.status(404).json({ message: "Không tìm thấy đơn hàng tư vấn hợp lệ." });
        }
        if (order.consultationSellerId.toString() !== sellerId.toString()) {
            return res.status(403).json({ message: "Bạn không có quyền cập nhật đơn hàng này." });
        }
        if (!['Đang tư vấn', 'Chờ tư vấn'].includes(order.status)) {
            return res.status(400).json({ message: `Không thể báo giá cho đơn hàng ở trạng thái "${order.status}".`});
        }

        let itemsTotal = 0;
        const enrichedItems = [];
        const sellerCommissionRate = req.user.commissionRate || 0;
        
        const originalConsultationItem = order.items[0];
        const originalProduct = await Product.findById(originalConsultationItem.productId).select('category images');
        if (!originalProduct) {
            throw new Error("Không tìm thấy sản phẩm gốc để lấy thông tin.");
        }
        const defaultCategoryId = originalProduct.category;
        const defaultImages = originalProduct.images;

        for (const item of items) {
            let currentProductId = item.productId;

            if (item.isCustom && !currentProductId) {
                if (!item.name || item.price == null) {
                    return res.status(400).json({ message: `Sản phẩm tùy chỉnh thiếu tên hoặc giá.` });
                }
                
                const newCustomProduct = new Product({
                    name: item.name,
                    price: item.price,
                    seller: sellerId,
                    category: defaultCategoryId,
                    stock: 5000,
                    weight: 10,
                    images: defaultImages,
                    description: item.name,
                    approvalStatus: 'approved',
                    requiresConsultation: false,
                });
                
                const savedProduct = await newCustomProduct.save();
                currentProductId = savedProduct._id;
            }
            
            if (!currentProductId) {
                 return res.status(400).json({ message: `Sản phẩm "${item.name}" không có ID hợp lệ.` });
            }

            const itemValue = item.price * item.quantity;
            itemsTotal += itemValue;

            enrichedItems.push({
                productId: currentProductId,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                sellerId: sellerId,
                commissionAmount: itemValue * (sellerCommissionRate / 100)
            });
        }
        
        // Tính lại phí ship dựa trên đơn hàng mới
        const { shippingFeeActual, shippingFeeCustomerPaid } = await shippingController.calculateFeeForOrder(
            order.shippingLocation,
            itemsTotal
        );

        // Cập nhật tất cả thông tin cho đơn hàng
        order.items = enrichedItems;
        order.sellerNotes = sellerNotes;
        order.shippingFeeActual = shippingFeeActual;
        order.shippingFeeCustomerPaid = shippingFeeCustomerPaid;
        const voucherDiscount = order.voucherDiscount || 0;
        order.total = itemsTotal + shippingFeeCustomerPaid - voucherDiscount;
        order.status = 'Chờ khách xác nhận';

        const updatedOrder = await order.save();
        
        // Tạo tin nhắn báo giá trong cuộc trò chuyện
        const conversation = await Conversation.findOne({
            productId: originalConsultationItem.productId,
            customerId: order.user,
            sellerId: sellerId,
        });

        if (conversation) {
            const quoteMessage = new Message({
                conversationId: conversation._id,
                senderId: sellerId,
                messageType: 'quote_summary',
                content: `Tôi đã tạo báo giá mới cho bạn. Tổng số tiền là ${order.total.toLocaleString()}đ.`,
                data: {
                    orderId: updatedOrder._id.toString(),
                    itemsTotal: itemsTotal,
                    shippingFee: shippingFeeCustomerPaid,
                    total: order.total
                }
            });
            await quoteMessage.save();
            conversation.updatedAt = new Date();
            await conversation.save();
        }

        // Gửi thông báo đẩy cho khách hàng
        const customer = await User.findById(order.user).select('fcmToken');
        if (customer) {
            const title = "Bạn có báo giá mới";
            const body = `Người bán đã gửi báo giá cho đơn hàng #${order._id.toString().slice(-6)}. Vui lòng vào ứng dụng để xác nhận.`;
            
            if (customer.fcmToken) {
                await safeNotify(customer.fcmToken, {
                    title, body,
                    data: { orderId: updatedOrder._id.toString(), type: 'new_quote_received' }
                });
            }
            await Notification.create({
                user: customer._id, title, message: body, type: 'order',
                data: { orderId: updatedOrder._id.toString() }
            });
        }
        
        res.json({ message: "Đã gửi báo giá cho khách hàng thành công.", order: updatedOrder });

    } catch (error) {
        console.error("Lỗi khi cập nhật và báo giá đơn hàng:", error);
        res.status(500).json({ message: error.message || "Lỗi server khi cập nhật đơn hàng." });
    }
};
