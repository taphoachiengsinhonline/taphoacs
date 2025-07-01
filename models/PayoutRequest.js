// models/PayoutRequest.js
const mongoose = require('mongoose');

const payoutRequestSchema = new mongoose.Schema({
    seller: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    amount: { // Số tiền yêu cầu rút
        type: Number,
        required: true,
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'rejected'],
        default: 'pending', // Chờ admin duyệt -> Đang xử lý -> Hoàn tất
    },
    rejectionReason: { // Lý do từ chối (nếu có)
        type: String,
    },
    processedAt: { // Ngày admin xử lý
        type: Date,
    },
    completedAt: { // Ngày admin xác nhận hoàn tất
        type: Date,
    },
}, { timestamps: true });

payoutRequestSchema.index({ seller: 1, status: 1 });

module.exports = mongoose.model('PayoutRequest', payoutRequestSchema);
