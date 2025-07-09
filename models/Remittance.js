// models/Remittance.js
const mongoose = require('mongoose');

const remittanceSchema = new mongoose.Schema({
    shipper: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    remittanceDate: { // Ngày cần đối soát
        type: Date,
        required: true
    },
    amount: { // Tổng số tiền đã nộp trong ngày đó
        type: Number,
        required: true,
        default: 0
    },
    // <<< THÊM TRƯỜNG STATUS >>>
    status: {
        type: String,
        enum: ['pending', 'completed'], // pending: shipper yêu cầu, completed: admin đã duyệt
        default: 'pending'
    },
    transactions: [{ // Ghi lại mỗi lần nộp tiền
        amount: Number,
        confirmedAt: { type: Date, default: Date.now },
        notes: String
    }]
}, { timestamps: true });

remittanceSchema.index({ shipper: 1, remittanceDate: 1 }, { unique: true });

module.exports = mongoose.model('Remittance', remittanceSchema);
