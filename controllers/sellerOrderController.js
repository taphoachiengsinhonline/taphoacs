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
        
        // --- BẮT ĐẦU SỬA ĐỔI ---

        // Lấy thông tin đầy đủ của sản phẩm tư vấn gốc
        const originalConsultationItem = order.items[0];
        const originalProduct = await Product.findById(originalConsultationItem.productId).select('category images');
        if (!originalProduct) {
            throw new Error("Không tìm thấy sản phẩm gốc để lấy thông tin.");
        }
        // Lấy các thông tin cần thiết từ sản phẩm gốc
        const defaultCategoryId = originalProduct.category;
        const defaultImages = originalProduct.images;

        // --- KẾT THÚC SỬA ĐỔI ---

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
                    // --- ÁP DỤNG CÁC YÊU CẦU MỚI ---
                    category: defaultCategoryId,    // 1. Lấy đúng category
                    stock: 5000,                    // 2. Stock mặc định 5000
                    weight: 10,                     // 3. Trọng lượng mặc định 10g
                    images: defaultImages,          // 4. Copy hình ảnh từ sản phẩm gốc
                    description: item.name,         // 5. Mô tả là tên sản phẩm
                    // ---
                    approvalStatus: 'approved',
                    requiresConsultation: false,
                });
                
                const savedProduct = await newCustomProduct.save();
                currentProductId = savedProduct._id;
                console.log(`Đã tạo sản phẩm tùy chỉnh mới với ID: ${currentProductId}`);
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
        
        // Cập nhật đơn hàng (logic giữ nguyên)
        order.items = enrichedItems;
        order.sellerNotes = sellerNotes;
        const shippingFee = order.shippingFeeCustomerPaid || 0;
        const voucherDiscount = order.voucherDiscount || 0;
        order.total = itemsTotal + shippingFee - voucherDiscount;
        order.status = 'Chờ khách xác nhận';

        const updatedOrder = await order.save();

        // Gửi thông báo cho khách hàng (logic giữ nguyên)
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
        res.status(500).json({ message: error.message || "Lỗi server khi cập nhật đơn hàng." });
    }
};
