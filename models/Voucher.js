const mongoose = require('mongoose');

const voucherSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: ['fixed', 'percentage'],
    required: true
  },
  value: {
    type: Number,
    required: true,
    min: 0
  },
  expiryDate: {
    type: Date,
    required: true
  },
  maxCollects: {
    type: Number,
    required: true,
    min: 1
  },
  currentCollects: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  isNewUserVoucher: {
    type: Boolean,
    default: false
  },
  applicableTo: {
    type: String,
    enum: ['shipping'],
    default: 'shipping'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Voucher', voucherSchema);
