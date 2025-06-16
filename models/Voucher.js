const mongoose = require('mongoose');

const voucherSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  type: { type: String, enum: ['fixed', 'percentage'], required: true }, // Loại giảm: cố định hoặc phần trăm
  value: { type: Number, required: true, min: 0 }, // Giá trị giảm (VNĐ hoặc %)
  expiryDate: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  maxCollects: { type: Number, required: true, min: 1 }, // Số lần tối đa thu thập
  currentCollects: { type: Number, default: 0 }, // Số lần đã thu thập
  isFeatured: { type: Boolean, default: false }, // Hiển thị trên trang chủ
  isNewUserVoucher: { type: Boolean, default: false }, // Dành cho khách mới
  applicableTo: { type: String, enum: ['shipping'], default: 'shipping' }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Voucher', voucherSchema);
