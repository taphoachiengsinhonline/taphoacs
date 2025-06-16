const mongoose = require('mongoose');

const shippingFeeSchema = new mongoose.Schema({
  ranges: [
    {
      maxDistance: {
        type: Number,
        required: true,
        min: 0
      },
      fee: {
        type: Number,
        required: true,
        min: 0
      }
    }
  ],
  freeShipThreshold: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  }
}, {
  versionKey: false,
  timestamps: true
});

module.exports = mongoose.model('ShippingFee', shippingFeeSchema);
