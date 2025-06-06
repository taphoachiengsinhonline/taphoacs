const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const orderItemSchema = new mongoose.Schema({
  productId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    ref: 'Product' 
  },
  name: { 
    type: String, 
    required: true,
    trim: true
  },
  quantity: { 
    type: Number, 
    required: true,
    min: 1
  },
  price: { 
    type: Number, 
    required: true,
    min: 0,
    set: v => Math.round(v * 100) / 100
  }
});

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: {
    type: [orderItemSchema],
    required: true,
    validate: v => Array.isArray(v) && v.length > 0
  },
  total: {
    type: Number,
    required: true,
    min: 0
  },
  customerName: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    match: [/^(0[3|5|7|8|9]|84[3|5|7|8|9]|\+84[3|5|7|8|9])[0-9]{7,8}$/, 'Số điện thoại không hợp lệ']
  },
  shippingAddress: {
    type: String,
    required: true,
    minlength: 10,
    trim: true
  },
  shippingLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],   // [lng, lat]
      required: true
    }
  },
  status: { 
    type: String,
    enum: ['Chờ xác nhận','Đang xử lý','Đang giao','Đã giao','Đã hủy'],
    default: 'Chờ xác nhận'
  },
  paymentMethod: {
    type: String,
    enum: ['COD','Chuyển khoản'],
    default: 'COD'
  },
  shipper: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  timestamps: {
     createdAt: { 
      type: Date, 
      default: Date.now // <-- Thêm dòng này
    }, 
    acceptedAt: Date,     // Thời điểm shipper nhận đơn
    processingAt: Date,   // Thời điểm bắt đầu xử lý
    deliveringAt: Date,   // Thời điểm bắt đầu giao hàng
    deliveredAt: Date,    // Thời điểm giao thành công
    canceledAt: Date,     // Thời điểm hủy
  }
}, {
  versionKey: false,
});

// Tích hợp plugin mongoose-paginate-v2
orderSchema.plugin(mongoosePaginate);

// Validate tổng tiền
orderSchema.pre('validate', function(next) {
  if (this.items.length) {
    const calced = this.items
      .reduce((acc, i) => acc + i.price * i.quantity, 0)
      .toFixed(2);
    if (this.total.toFixed(2) !== calced) {
      this.invalidate('total', `Tổng tiền không khớp (${this.total} ≠ ${calced})`);
    }
  }
  next();
});

orderSchema.index({ shippingLocation: '2dsphere' });

module.exports = mongoose.model('Order', orderSchema);
