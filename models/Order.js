// models/order.model.js
const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    ref: 'Product' 
  },
  name: { 
    type: String, 
    required: [true, 'Tên sản phẩm là bắt buộc'] 
  },
  quantity: { 
    type: Number, 
    required: [true, 'Số lượng là bắt buộc'],
    min: [1, 'Số lượng tối thiểu là 1']
  },
  price: { 
    type: Number, 
    required: [true, 'Giá sản phẩm là bắt buộc'],
    min: [0, 'Giá không thể âm']
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
    match: [/^(0[3|5|7|8|9])+([0-9]{8})$/, 'Số điện thoại không hợp lệ']
  },
  shippingAddress: {
    type: String,
    required: [true, 'Địa chỉ giao hàng là bắt buộc'],
    minlength: [10, 'Địa chỉ quá ngắn (tối thiểu 10 ký tự)']
  },
  customerName: {
    type: String,
    required: [true, 'Tên khách hàng là bắt buộc']
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
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
}, {
  versionKey: false,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Thêm validate trước khi save
orderSchema.pre('validate', function(next) {
  if (this.items) {
    const calculatedTotal = this.items.reduce(
      (sum, item) => sum + (item.price * item.quantity),
      0
    );
    
    if (this.total !== calculatedTotal) {
      this.invalidate('total', 'Tổng tiền không khớp với giá sản phẩm');
    }
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
