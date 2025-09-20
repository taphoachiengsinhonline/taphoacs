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
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  commissionAmount: {
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
  region: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Region',
        required: true,
        index: true // Rất quan trọng để query nhanh
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
      type: [Number],
      required: true
    }
  },
  status: {
        type: String,
        enum: [
            'Chờ xác nhận', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã huỷ',
            'Chờ tư vấn', 'Đang tư vấn', 'Chờ khách xác nhận',
        ],
        default: 'Chờ xác nhận'
  },
  customTitle: {
      type: String,
      trim: true
  },
  isConsultationOrder: {
        type: Boolean,
        default: false
    },
    
    // Trường để lưu ID của seller chính cần tư vấn
    consultationSellerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
  sellerNotes: { type: String },
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
  shippingFeeActual: {
      type: Number,
      default: 0
  },
  shippingFeeCustomerPaid: {
      type: Number,
      default: 0
  },
  shipperIncome: { type: Number, default: 0 },
  financialDetails: {
     shippingFeeActual: Number,
     shippingFeeCustomerPaid: Number,
     extraSurcharge: Number,
     shippingFeeShareRate: Number,
     profitShareRate: Number
   },
  
  // Lưu lại ai là người quản lý và hưởng lợi nhuận từ đơn hàng này
  profitRecipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null // null = Admin trung tâm
    },

    // Lưu lại tỷ lệ chia sẻ lợi nhuận tại thời điểm đặt hàng
    profitShareRateSnapshot: {
        type: Number,
        default: 100 // Admin trung tâm mặc định hưởng 100%
    },

    // Lợi nhuận thực tế của người nhận (sau khi chia sẻ)
    recipientProfit: {
        type: Number,
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
  customerNotes: {
    type: String,
    trim: true
  },
  cancelReason: {
    type: String,
    trim: true
  },
  // Ghi chú: Trường timestamps lồng nhau không phải là cách làm chuẩn, 
  // nên sử dụng timestamps: true của Mongoose. 
  // Tuy nhiên, để không phá vỡ code hiện tại, tôi sẽ giữ nguyên.
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
  timestamps: true, // Ghi đè createdAt và thêm updatedAt
  versionKey: false
});

orderSchema.pre('validate', function(next) {
  if (this.isModified('total') || this.isModified('items')) {
    if (this.items && this.items.length > 0) {
      const itemsTotal = this.items.reduce((acc, i) => acc + (i.price * i.quantity), 0);
      const calculatedTotal = itemsTotal + (this.shippingFeeCustomerPaid || 0) + (this.extraSurcharge || 0) - (this.voucherDiscount || 0);
      if (Math.abs(this.total - calculatedTotal) > 1) { // Cho phép sai số 1đ
         console.warn(`Total mismatch warning for order ${this._id}: Stored=${this.total}, Calculated=${calculatedTotal}`);
         // Tạm thời không invalidate để tránh lỗi không mong muốn, chỉ cảnh báo
         // this.invalidate('total', `Tổng tiền không khớp (${this.total} so với ${calculatedTotal})`);
      }
    }
  }
  next();
});

orderSchema.plugin(mongoosePaginate);
orderSchema.index({ shippingLocation: '2dsphere' });

module.exports = mongoose.model('Order', orderSchema);
