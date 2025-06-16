const mongoose = require('mongoose');

const userVoucherSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  voucher: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher', required: true },
  isUsed: { type: Boolean, default: false },
  usedAt: { type: Date },
  collectedAt: { type: Date, default: Date.now }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('UserVoucher', userVoucherSchema);
