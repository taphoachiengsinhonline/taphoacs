const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, required: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true }
});

const customerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId },
  name: { type: String },
  phone: { type: String, required: true },
  address: { type: String, required: true }
});

const orderSchema = new mongoose.Schema({
  items: [orderItemSchema],
  total: { type: Number, required: true },
  customer: customerSchema,
  status: { 
    type: String, 
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);
