const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  user: { type: String, required: true },
  phone: String,
  shippingAddress: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User'},
  items: [{ name: String, price: Number, quantity: Number }],
  total: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);

