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

        // Validation: items phải là một mảng và không rỗng
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: "Vui lòng thêm ít nhất một sản phẩm vào báo giá." });
        }

        const order = await Order.findById(orderId);
        // Kiểm tra quyền của seller...

        let finalTotal = 0;
        const enrichedItems = [];
        const sellerCommissionRate = req.user.commissionRate || 0;

        for (const item of items) {
            // Validation cho mỗi item
            if (!item.name || !item.price || !item.quantity) {
                return res.status(400).json({ message: `Sản phẩm "${item.name || ''}" thiếu thông tin.` });
            }
            const itemValue = item.price * item.quantity;
            finalTotal += itemValue;

            enrichedItems.push({
                productId: item.productId || null, // Lưu ID nếu là sản phẩm có sẵn
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                images: item.images || [],
                weight: item.weight || 0,
                sellerId: sellerId,
                commissionAmount: itemValue * (sellerCommissionRate / 100),
                isCustom: !item.productId // Đánh dấu là sản phẩm tùy chỉnh
            });
        }

        // Cập nhật đơn hàng
        order.items = enrichedItems;
        order.total = finalTotal;
        order.sellerNotes = sellerNotes;
        order.status = 'Chờ khách xác nhận';

        const updatedOrder = await order.save();

        // Gửi thông báo cho khách hàng...
        
        res.json({ message: "Đã gửi báo giá cho khách hàng thành công.", order: updatedOrder });
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi cập nhật đơn hàng." });
    }
};
