const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  newUserVoucherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Voucher',
    default: null
  },
  newUserVoucherEnabled: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Settings', settingsSchema);
