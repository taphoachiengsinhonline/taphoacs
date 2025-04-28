// models/order.model.js
const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: [true, 'Mã sản phẩm là bắt buộc'],
    ref: 'Product' 
  },
  name: { 
    type: String, 
    required: [true, 'Tên sản phẩm là bắt buộc'],
    trim: true
  },
  quantity: { 
    type: Number, 
    required: [true, 'Số lượng là bắt buộc'],
    min: [1, 'Số lượng tối thiểu là 1']
  },
  price: { 
    type: Number, 
    required: [true, 'Giá sản phẩm là bắt buộc'],
    min: [0, 'Giá không thể âm'],
    set: v => Math.round(v * 100) / 100
  }
});

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Người dùng là bắt buộc']
  },
  items: {
    type: [orderItemSchema],
    required: [true, 'Danh sách sản phẩm là bắt buộc'],
    validate: {
      validator: (v) => Array.isArray(v) && v.length > 0,
      message: 'Đơn hàng phải có ít nhất 1 sản phẩm'
    }
  },
  total: {
    type: Number,
    required: [true, 'Tổng tiền là bắt buộc'],
    min: [0, 'Tổng tiền không thể âm']
  },
  phone: {
    type: String,
    required: [true, 'Số điện thoại là bắt buộc'],
    match: [/^(0[3|5|7|8|9]|84[3|5|7|8|9]|\+84[3|5|7|8|9])+([0-9]{7,8})$/,
      'Số điện thoại không hợp lệ (VD: 0912345678 hoặc +84912345678)'],
    trim: true
  },
  shippingAddress: {
    type: String,
    required: [true, 'Địa chỉ giao hàng là bắt buộc'],
    minlength: [10, 'Địa chỉ phải có ít nhất 10 ký tự'],
    trim: true
  },
  customerName: {
    type: String,
    required: [true, 'Tên khách hàng là bắt buộc'],
    trim: true
  },
  status: { 
    type: String, 
    enum: {
      values: [
        'Chờ xác nhận',
        'Đang xử lý',
        'Đang giao',
        'Đã giao',
        'Đã hủy'
      ],
      message: 'Trạng thái không hợp lệ'
    },
    default: 'Chờ xác nhận'
  },
  paymentMethod: {
    type: String,
    enum: ['COD', 'Chuyển khoản'],
    default: 'COD'
  }
}, {
  versionKey: false,
  timestamps: true, // ✅ Tự động thêm createdAt và updatedAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

orderSchema.pre('validate', function(next) {
  if (this.items && this.items.length > 0) {
    const calculatedTotal = this.items.reduce(
      (sum, item) => sum + (item.price * item.quantity),
      0
    ).toFixed(2); // ✅ Làm tròn 2 số thập phân
    
    if (this.total.toFixed(2) !== calculatedTotal) {
      this.invalidate('total', `Tổng tiền không khớp (${this.total} ≠ ${calculatedTotal})`);
    }
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
