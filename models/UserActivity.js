// models/UserActivity.js
const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    activityType: {
        type: String,
        enum: ['view_product', 'search', 'add_to_cart', 'view_category', 'purchase'],
        required: true,
        index: true
    },
    // Dữ liệu liên quan đến hành vi
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    searchQuery: { type: String },
    
    // Lưu lại thông tin đơn hàng nếu là hành vi 'purchase'
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },

}, { timestamps: true });

// Tự động xóa log hành vi sau 90 ngày để DB không bị phình to
userActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('UserActivity', userActivitySchema);
