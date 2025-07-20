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
    // Ví dụ: 'finance' cho các thông báo tài chính, 'order' cho đơn hàng, 'general' cho thông báo chung.
    type: {
        type: String,
        enum: ['finance', 'order', 'general', 'promotion'], // Các loại thông báo có thể có
        default: 'general'
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
    // `createdAt` sẽ được dùng cho TTL Index.
    timestamps: true 
});

// *** TTL (Time-To-Live) Index ***
// Đây là tính năng mạnh mẽ của MongoDB để tự động xóa các document sau một khoảng thời gian nhất định.
// 'createdAt': Trường chứa thời gian tạo document.
// 'expireAfterSeconds': Số giây mà document sẽ tồn tại trước khi bị xóa.
// 864000 giây = 10 ngày (10 * 24 * 60 * 60)
// MongoDB sẽ tự động kiểm tra và xóa các document có 'createdAt' đã quá 10 ngày.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 864000 });

module.exports = mongoose.model('Notification', notificationSchema);
