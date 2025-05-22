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
    min: [0, 'Tổng tiền không thể âm'],
    set: v => Math.round(v * 100) / 100 // Thêm làm tròn
  },
  customerName: {
    type: String,
    required: [true, 'Tên khách hàng là bắt buộc'],
    trim: true
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
  status: { 
    type: String, 
    enum: {
      values: ['Chờ xác nhận', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã hủy'],
      message: 'Trạng thái không hợp lệ'
    },
    default: 'Chờ xác nhận'
  },
  paymentMethod: {
    type: String,
    enum: ['COD', 'Chuyển khoản'],
    default: 'COD'
  },
  deliveryStaff: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  shippingLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [lng, lat]
      default: [0, 0]
    }
  },
  tracking: [{
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: { type: [Number] }
    },
    timestamp: { type: Date, default: Date.now }
  }],
  assignedAt: {
    type: Date
  }
}, {
  versionKey: false,
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Tạo index cho tìm kiếm địa lý
orderSchema.index({ shippingLocation: '2dsphere' });

// Middleware validate tổng tiền
orderSchema.pre('validate', function(next) {
  if (this.items && this.items.length > 0) {
    const calculatedTotal = this.items.reduce((sum, item) => {
      if (!item.price || !item.quantity) {
        throw new Error('Giá hoặc số lượng sản phẩm không hợp lệ');
      }
      return sum + (item.price * item.quantity);
    }, 0);
    
    if (Math.round(this.total * 100) / 100 !== Math.round(calculatedTotal * 100) / 100) {
      this.invalidate('total', `Tổng tiền không khớp (${this.total} ≠ ${calculatedTotal})`);
    }
  }
  next();
});

// Middleware validate cập nhật
orderSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  const statusPath = orderSchema.path('status');

  if (update.status && !statusPath.enumValues.includes(update.status)) {
    return next(new Error(`Trạng thái không hợp lệ. Chỉ chấp nhận: ${statusPath.enumValues.join(', ')}`));
  }

  if (update.phone) {
    const phoneRegex = orderSchema.path('phone').options.match[0];
    if (!new RegExp(phoneRegex).test(update.phone)) {
      return next(new Error('Số điện thoại không hợp lệ'));
    }
  }

  if (update.total && update.items) {
    const calculatedTotal = update.items.reduce((sum, item) => {
      if (!item.price || !item.quantity) {
        throw new Error('Giá hoặc số lượng sản phẩm không hợp lệ');
      }
      return sum + (item.price * item.quantity);
    }, 0);
    if (Math.round(update.total * 100) / 100 !== Math.round(calculatedTotal * 100) / 100) {
      return next(new Error(`Tổng tiền không khớp (${update.total} ≠ ${calculatedTotal})`));
    }
  }

  next();
});

module.exports = mongoose.model('Order', orderSchema);
