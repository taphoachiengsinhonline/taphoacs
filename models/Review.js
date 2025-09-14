// File: backend/models/Review.js
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    orderId: { // Để biết đánh giá này thuộc đơn hàng nào
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true
    },
    user: { // Người đánh giá (customer)
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    reviewFor: { // Đánh giá cho 'product' hay 'shipper'
        type: String,
        enum: ['product', 'shipper'],
        required: true
    },
    targetId: { // ID của sản phẩm hoặc shipper được đánh giá
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    rating: { // Số sao
        type: Number,
        min: 1,
        max: 5,
        required: true
    },
    comment: { // Bình luận
        type: String,
        trim: true
    }
}, { timestamps: true });

// Ngăn một user đánh giá cùng một sản phẩm/shipper 2 lần cho cùng 1 đơn hàng
reviewSchema.index({ orderId: 1, user: 1, targetId: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
