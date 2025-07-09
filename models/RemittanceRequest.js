// models/RemittanceRequest.js
const mongoose = require('mongoose');

const remittanceRequestSchema = new mongoose.Schema({
    shipper: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    shipperNotes: String, // Ghi chú của shipper nếu có
    adminNotes: String,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    processedAt: Date,
    isForOldDebt: { // Mục đích của yêu cầu: true-trả nợ cũ, false-trả nợ hôm nay
        type: Boolean, 
        default: false 
    }
}, { timestamps: true });

module.exports = mongoose.model('RemittanceRequest', remittanceRequestSchema);
