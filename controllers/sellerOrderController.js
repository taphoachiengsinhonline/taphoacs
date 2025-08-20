const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');

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

        if (!order) {
            return res.status(404).json({ message: "Không tìm thấy đơn hàng." });
        }

        // Kiểm tra quyền sở hữu của Seller
        if (order.consultationSellerId.toString() !== sellerId.toString()) {
            return res.status(403).json({ message: "Bạn không có quyền cập nhật đơn hàng này." });
        }
        
        if (order.status !== 'Đang tư vấn' && order.status !== 'Chờ tư vấn') {
            return res.status(400).json({ message: `Không thể báo giá cho đơn hàng ở trạng thái "${order.status}".`});
        }

        let itemsTotal = 0;
        const enrichedItems = [];
        const sellerCommissionRate = req.user.commissionRate || 0;

        for (const item of items) {
            if (!item.name || item.price == null || !item.quantity) {
                return res.status(400).json({ message: `Sản phẩm "${item.name || ''}" thiếu thông tin tên, giá hoặc số lượng.` });
            }
            const itemValue = item.price * item.quantity;
            itemsTotal += itemValue;

            enrichedItems.push({
                productId: item.productId || null,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                images: item.images || [],
                weight: item.weight || 0,
                sellerId: sellerId,
                commissionAmount: itemValue * (sellerCommissionRate / 100),
                isCustom: item.isCustom || false
            });
        }
        
        // Cập nhật items và sellerNotes
        order.items = enrichedItems;
        order.sellerNotes = sellerNotes;
        
        // TÍNH TOÁN LẠI TỔNG TIỀN CUỐI CÙNG MỘT CÁCH CHÍNH XÁC
        // Giả sử phí ship và voucher không thay đổi so với lúc ban đầu
        const shippingFee = order.shippingFeeCustomerPaid || 0;
        const voucherDiscount = order.voucherDiscount || 0;
        order.total = itemsTotal + shippingFee - voucherDiscount;
        
        // Chuyển trạng thái
        order.status = 'Chờ khách xác nhận';

        const updatedOrder = await order.save();

        // Gửi thông báo cho khách hàng
        const customer = await User.findById(order.user).select('fcmToken');
        if (customer) {
            const title = "Bạn có báo giá mới";
            const body = `Người bán đã gửi báo giá cho đơn hàng #${order._id.toString().slice(-6)}. Vui lòng xác nhận.`;
            
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
        res.status(500).json({ message: "Lỗi server khi cập nhật đơn hàng." });
    }
};
