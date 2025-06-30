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
  },

  sellerId: { // <-- Thêm trường này để dễ truy vấn
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  commissionRate: { // <-- Lưu lại chiết khấu tại thời điểm mua
    type: Number,
    required: true,
    default: 0,
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
    enum: ['Chờ xác nhận','Đang xử lý','Đang giao','Đã giao','Đã huỷ'],
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
  shippingFee: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },

  extraSurcharge: {
    type: Number,
    min: 0,
    default: 0
  },
  
    
  voucherDiscount: {
    type: Number,
    min: 0,
    default: 0
  },
  voucherCode: {
    type: String,
    trim: true,
    default: null
  },
  timestamps: {
    createdAt: { 
      type: Date, 
      default: Date.now
    }, 
    acceptedAt: Date,
    processingAt: Date,
    deliveringAt: Date,
    deliveredAt: Date,
    canceledAt: Date
  }
}, {
  versionKey: false
});

// Validate tổng tiền
orderSchema.pre('validate', function(next) {
  if (this.items.length) {
    const itemsTotal = this.items.reduce((acc, i) => acc + i.price * i.quantity, 0);
    // Cộng tất cả các khoản phí vào
    const calculatedTotal = itemsTotal + this.shippingFee + (this.extraSurcharge || 0) - (this.voucherDiscount || 0);

    // So sánh với sai số nhỏ để tránh lỗi dấu phẩy động
    if (Math.abs(this.total - calculatedTotal) > 0.01) {
       this.invalidate('total', `Tổng tiền không khớp (${this.total} so với ${calculatedTotal})`);
    }
  }
  next();
});

// Tích hợp plugin mongoose-paginate-v2
orderSchema.plugin(mongoosePaginate);
orderSchema.index({ shippingLocation: '2dsphere' });
module.exports = mongoose.model('Order', orderSchema);
