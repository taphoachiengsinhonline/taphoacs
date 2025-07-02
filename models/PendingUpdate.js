// models/PendingUpdate.js
const mongoose = require('mongoose');

const pendingUpdateSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, enum: ['paymentInfo'] },
    otp: { type: String, required: true },
    payload: { type: Object, required: true }, // Nơi lưu thông tin mới (bankName, accountNumber...)
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 5*60*1000), // Hết hạn sau 5 phút
        index: { expires: '5m' }
    }
}, { timestamps: true });

module.exports = mongoose.model('PendingUpdate', pendingUpdateSchema);
