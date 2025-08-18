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
        const { items, finalTotal, sellerNotes } = req.body;
        const sellerId = req.user._id;

        const order = await Order.findById(orderId);
        // Kiểm tra quyền của seller với đơn hàng này...

        // Cập nhật lại đơn hàng
        order.items = items; // items này là một mảng object sản phẩm có giá
        order.total = finalTotal;
        order.sellerNotes = sellerNotes;
        order.status = 'Chờ khách xác nhận';

        // Tính lại hoa hồng và thu nhập shipper (nếu có)
        // ...
        
        const updatedOrder = await order.save();

        // Gửi thông báo cho khách hàng rằng đơn hàng đã được báo giá
        // ...

        res.json({ message: "Đã gửi báo giá cho khách hàng thành công.", order: updatedOrder });
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi cập nhật đơn hàng." });
    }
};
