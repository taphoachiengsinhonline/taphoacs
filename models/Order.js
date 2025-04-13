// models/Order.js
const mongoose = require('mongoose');

// Schema cho từng sản phẩm trong đơn hàng
const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Số lượng phải lớn hơn 0']
  },
  price: {
    type: Number,
    required: true,
    min: [0, 'Giá phải lớn hơn hoặc bằng 0']
  }
}, { _id: false }); // Không tạo _id cho từng item

// Schema chính của đơn hàng
const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: {
    type: [orderItemSchema],
    required: true,
    validate: [arr => arr.length > 0, 'Đơn hàng phải có ít nhất 1 sản phẩm']
  },
  total: {
    type: Number,
    required: true,
    min: [0, 'Tổng tiền phải lớn hơn hoặc bằng 0']
  },
  phone: {
    type: String,
    required: [true, 'Vui lòng nhập số điện thoại'],
    match: [
      /^(0[35789]|84[35789]|01[2689])([0-9]{8})$/,
      'Số điện thoại không hợp lệ'
    ]
  },
  shippingAddress: {
    type: String,
    required: [true, 'Vui lòng nhập địa chỉ giao hàng'],
    minlength: [10, 'Địa chỉ phải có ít nhất 10 ký tự']
  },
  note: {
    type: String,
    default: ''
  },
  paymentMethod: {
    type: String,
    enum: ['COD', 'BankTransfer', 'Momo'],
    default: 'COD'
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'shipping', 'delivered', 'cancelled'],
    default: 'pending'
  }
}, {
  timestamps: true
});

// Tự động bỏ __v khi trả JSON
orderSchema.methods.toJSON = function () {
  const order = this.toObject();
  delete order.__v;
  return order;
};

module.exports = mongoose.model('Order', orderSchema);
