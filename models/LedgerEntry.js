// models/LedgerEntry.js
const mongoose = require('mongoose');

const ledgerEntrySchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  order: { // Giao dịch liên quan đến đơn hàng nào
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
  },

   payoutRequest: { // Giao dịch liên quan đến yêu cầu rút tiền nào
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PayoutRequest',
    },

  
  type: { // Loại giao dịch: Ghi có (doanh thu), Ghi nợ (rút tiền/thanh toán)
    type: String,
    enum: ['credit', 'debit'],
    required: true,
  },
  amount: { // Số tiền (luôn là số dương)
    type: Number,
    required: true,
  },
  description: { // Mô tả giao dịch
    type: String,
    required: true,
  },
  balanceAfter: { // Số dư sau giao dịch
    type: Number,
    required: true,
  }
}, { timestamps: true });

ledgerEntrySchema.index({ seller: 1, createdAt: -1 });

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
