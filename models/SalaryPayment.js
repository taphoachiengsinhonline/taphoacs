// models/SalaryPayment.js
const mongoose = require('mongoose');

const salaryPaymentSchema = new mongoose.Schema({
    shipper: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    amount: {
        type: Number,
        required: true
    },
    paymentDate: { // Ngày của tháng lương được trả, ví dụ: '2023-05-01'
        type: Date,
        required: true
    },
    paidBy: { // Admin thực hiện thanh toán
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    notes: String // Ghi chú của admin
}, { timestamps: true });

module.exports = mongoose.model('SalaryPayment', salaryPaymentSchema);
