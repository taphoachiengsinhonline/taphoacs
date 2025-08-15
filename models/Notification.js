const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    user: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true
    },
    title: {
        type: String,
        required: [true, 'Tiêu đề thông báo là bắt buộc.'],
        trim: true
    },
    message: {
        type: String,
        required: [true, 'Nội dung thông báo là bắt buộc.']
    },
    type: {
        type: String,
        enum: [
            'order',
            'finance',
            'remittance',
            'payout',
            'product',
            'general',
            'promotion',
            'order_accepted_by_shipper' // Thêm type này cho rõ ràng
        ],
        default: 'general'
    },
    isRead: {
        type: Boolean,
        default: false,
        index: true
    },
    data: {
        type: Object,
        default: {}
    }
}, { 
    timestamps: true 
});

notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 864000 }); // 10 ngày

module.exports = mongoose.model('Notification', notificationSchema);
