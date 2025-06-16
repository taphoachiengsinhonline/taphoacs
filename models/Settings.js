const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  newUserVoucherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher' },
  newUserVoucherEnabled: { type: Boolean, default: false }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Settings', settingsSchema);
