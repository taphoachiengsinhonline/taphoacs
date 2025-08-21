const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const Notification = require('../models/Notification');
// << TÔI ĐÃ THÊM LẠI CÁC IMPORT BỊ THIẾU Ở CÂU TRẢ LỜI TRƯỚC, GIỜ THÊM TIẾP >>
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const shippingController = require('./shippingController'); // <<< THÊM DÒNG NÀY VÀO ĐÂY
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
        const { items, sellerNotes, quoteTitle } = req.body;
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
        const originalProduct = await Product.findById(originalConsultationItem.productId).select('category images saleTimeFrames');
        if (!originalProduct) {
            throw new Error("Không tìm thấy sản phẩm gốc để lấy thông tin.");
        }
        const defaultCategoryId = originalProduct.category;
        const defaultImages = originalProduct.images;
        const defaultSaleTimeFrames = originalProduct.saleTimeFrames;

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
                    saleTimeFrames: defaultSaleTimeFrames,
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
        
        const { shippingFeeActual, shippingFeeCustomerPaid } = await shippingController.calculateFeeForOrder(
            order.shippingLocation,
            itemsTotal
        );

        order.items = enrichedItems;
        order.sellerNotes = sellerNotes;
        order.shippingFeeActual = shippingFeeActual;
        order.shippingFeeCustomerPaid = shippingFeeCustomerPaid;
        order.total = itemsTotal + shippingFeeCustomerPaid - (order.voucherDiscount || 0);
        order.status = 'Chờ khách xác nhận';
        
        if (quoteTitle && quoteTitle.trim() !== '') {
            order.customTitle = quoteTitle.trim();
        }

        const updatedOrder = await order.save();
        
        const conversation = await Conversation.findOne({
            productId: originalConsultationItem.productId,
            customerId: order.user,
            sellerId: sellerId,
        });

        if (conversation) {
            // --- BẮT ĐẦU SỬA Ở ĐÂY ---
            const quoteMessage = new Message({
                conversationId: conversation._id,
                senderId: sellerId,
                messageType: 'quote_summary',
                // Sửa lại content mặc định
                content: `Đơn hàng #${updatedOrder._id.toString().slice(-6)}. Tổng số tiền: ${order.total.toLocaleString()}đ.`,
                data: {
                    orderId: updatedOrder._id.toString(),
                    itemsTotal: itemsTotal,
                    shippingFee: shippingFeeCustomerPaid,
                    total: order.total,
                    status: updatedOrder.status,
                    // THÊM 2 TRƯỜNG MỚI
                    quoteTitle: order.customTitle || `Báo giá cho ${order.customerName}`, // Gửi kèm tiêu đề
                    items: enrichedItems.map(item => ({ // Gửi kèm danh sách sản phẩm đã được rút gọn
                        name: item.name,
                        price: item.price,
                        quantity: item.quantity
                    }))
                }
            });
            // --- KẾT THÚC SỬA Ở ĐÂY ---

            await quoteMessage.save();
            conversation.updatedAt = new Date();
            await conversation.save();
        }

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

        const finalRelatedOrder = await Order.findById(updatedOrder._id)
            .select('_id status items customTitle total')
            .lean();

        const finalConversation = await Conversation.findById(conversation._id)
            .populate('sellerId', 'name')
            .populate('productId', 'name images price variantTable requiresConsultation')
            .lean();
        
        finalConversation.relatedOrder = finalRelatedOrder;
        
        res.json({ 
            message: "Đã gửi báo giá cho khách hàng thành công.", 
            order: updatedOrder,
            conversation: finalConversation
        });

    } catch (error) {
        console.error("Lỗi khi cập nhật và báo giá đơn hàng:", error);
        res.status(500).json({ message: error.message || "Lỗi server khi cập nhật đơn hàng." });
    }
};
