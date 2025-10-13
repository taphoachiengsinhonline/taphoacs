// File: backend/models/RegionManagerPayment.js

const mongoose = require('mongoose');

const regionManagerPaymentSchema = new mongoose.Schema({
    regionManager: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    amount: {
        type: Number,
        required: true,
        min: 1
    },
    paymentDate: {
        type: Date,
        default: Date.now
    },
    notes: {
        type: String,
        trim: true
    },
    paidBy: { // Admin nào đã thanh toán
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('RegionManagerPayment', regionManagerPaymentSchema);
