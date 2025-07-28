const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    // User nhận thông báo (có thể là shipper, customer, admin...).
    // Tạo index để tăng tốc độ truy vấn tìm kiếm thông báo theo user.
    user: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true
    },

    // Tiêu đề của thông báo, giúp phân loại nhanh.
    // Ví dụ: "Yêu cầu nộp tiền COD", "Đơn hàng mới", "Hệ thống bảo trì".
    title: {
        type: String,
        required: [true, 'Tiêu đề thông báo là bắt buộc.'], // Thêm message báo lỗi
        trim: true // Tự động xóa khoảng trắng thừa ở đầu và cuối
    },

    // Nội dung chi tiết của thông báo.
    message: {
        type: String,
        required: [true, 'Nội dung thông báo là bắt buộc.']
    },

    // Phân loại thông báo để xử lý logic ở frontend.
    type: {
        type: String,
        // <<< BẮT ĐẦU SỬA LỖI: THÊM CÁC GIÁ TRỊ MỚI VÀO ENUM >>>
        enum: [
            'order',        // Liên quan đến trạng thái đơn hàng
            'finance',      // Tài chính chung (vd: admin nhắc nợ, lương)
            'remittance',   // Cụ thể cho yêu cầu nộp tiền của shipper
            'payout',       // Cụ thể cho yêu cầu rút tiền của seller
            'product',      // Liên quan đến sản phẩm (được duyệt, bị từ chối)
            'general',      // Thông báo chung
            'promotion'     // Khuyến mãi
        ],
        default: 'general'
        // <<< KẾT THÚC SỬA LỖI >>>
    },

    // Trường quan trọng: Đánh dấu thông báo đã được đọc hay chưa.
    // Tạo index giúp việc đếm số thông báo chưa đọc (unreadCount) nhanh hơn.
    isRead: {
        type: Boolean,
        default: false,
        index: true
    },

    // Một trường linh hoạt để chứa dữ liệu bổ sung.
    // Giúp frontend biết cần điều hướng đến đâu khi người dùng click vào.
    // Ví dụ: { orderId: '...' } hoặc { screen: 'Report' }.
    data: {
        type: Object,
        default: {}
    }
}, { 
    // Tự động thêm hai trường: createdAt và updatedAt.
    timestamps: true 
});

// TTL (Time-To-Live) Index để tự động xóa thông báo cũ
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 864000 }); // 10 ngày

module.exports = mongoose.model('Notification', notificationSchema);
