// models/Product.js
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  images: {
    type: [String],
    default: []
  },
   price: {
    type: Number,
    required: function() {
      return !this.variantTable || this.variantTable.length === 0;
    },
    min: 0
  },
  stock: {
    type: Number,
    required: function() {
      return !this.variantTable || this.variantTable.length === 0;
    },
    min: 0,
    default: 0
  },
  saleTimeFrames: [{
        start: { type: String, required: true },
        end: { type: String, required: true }
  }],
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  },
  weight: {
    type: Number,
    default: 0
  },
   barcode: {
    type: String,
    trim: true,
    default: ''
  },
  variantGroups: [{
    name: String,
    options: [String]
  }],
  variantTable: [{
    combination: String,
    price: Number,
    stock: Number,
    sku: String
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvalStatus: {
    type: String,
    enum: ['pending_approval', 'approved', 'rejected'],
    default: 'pending_approval'
  },
  rejectionReason: {
    type: String
  }
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });


// 2. (Tùy chọn nhưng khuyến khích) Thêm validation mới cho trường `saleTimeFrames`
productSchema.path('saleTimeFrames').validate(function(timeFrames) {
  // Cho phép mảng rỗng (nghĩa là bán 24/7)
  if (!timeFrames || timeFrames.length === 0) {
    return true;
  }
  
  // Kiểm tra từng object trong mảng
  for (const frame of timeFrames) {
    const isValidStart = frame.start && /^(?:2[0-3]|[01]?[0-9]):[0-5][0-9]$/.test(frame.start);
    const isValidEnd = frame.end && /^(?:2[0-3]|[01]?[0-9]):[0-5][0-9]$/.test(frame.end);
    
    // Nếu có một khung giờ không hợp lệ, trả về false
    if (!isValidStart || !isValidEnd) {
      return false;
    }
  }
  
  // Tất cả đều hợp lệ
  return true;
}, 'Một hoặc nhiều khung giờ bán có định dạng không hợp lệ. Vui lòng dùng định dạng "HH:mm".');

// <<< KẾT THÚC SỬA LỖI >>>


// Virtual `totalStock` để tính tổng tồn kho
productSchema.virtual('totalStock').get(function() {
  if (this.variantTable && this.variantTable.length > 0) {
    return this.variantTable.reduce((sum, variant) => sum + (variant.stock || 0), 0);
  }
  return this.stock || 0;
});

// Đảm bảo trường ảo được bao gồm khi chuyển đổi sang JSON/Object
// Ghi chú: `toJSON: { virtuals: true }` ở đầu schema đã làm việc này rồi,
// nhưng để 2 dòng này cũng không sao.
productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Product', productSchema);
