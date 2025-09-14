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
    // Chỉ bắt buộc khi không có phân loại VÀ không yêu cầu tư vấn
    required: function() {
      const hasVariants = this.variantTable && this.variantTable.length > 0;
      return !hasVariants && !this.requiresConsultation;
    },
    min: 0
  },
  stock: {
    type: Number,
    // Chỉ bắt buộc khi không có phân loại VÀ không yêu cầu tư vấn
    required: function() {
      const hasVariants = this.variantTable && this.variantTable.length > 0;
      return !hasVariants && !this.requiresConsultation;
    },
    min: 0,
    default: 0
  },
  // THAY THẾ: Sử dụng mảng các khung giờ
  saleTimeFrames: [{
        start: { type: String, required: true }, // "HH:mm"
        end: { type: String, required: true }    // "HH:mm"
  }],
  category: {
    type: mongoose.Schema.Types.ObjectId, // Đổi sang ObjectId để populate
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
  region: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Region',
        required: true,
        index: true // Rất quan trọng để query nhanh
    },
  approvalStatus: {
    type: String,
    enum: ['pending_approval', 'approved', 'rejected'],
    default: 'pending_approval'
  },
  rejectionReason: {
    type: String
  },
  // THÊM: Trường mới cho sản phẩm cần tư vấn
  requiresConsultation: {
    type: Boolean,
    default: false,
  },
  ratingAverage: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
        set: val => Math.round(val * 10) / 10 // Làm tròn đến 1 chữ số thập phân
    },
    ratingQuantity: {
        type: Number,
        default: 0
    },
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

// Validation mới cho saleTimeFrames
productSchema.path('saleTimeFrames').validate(function(timeFrames) {
  if (!timeFrames || timeFrames.length === 0) {
    return true; // Cho phép mảng rỗng (bán 24/7)
  }
  for (const frame of timeFrames) {
    const isValidStart = frame.start && /^(?:2[0-3]|[01]?[0-9]):[0-5][0-9]$/.test(frame.start);
    const isValidEnd = frame.end && /^(?:2[0-3]|[01]?[0-9]):[0-5][0-9]$/.test(frame.end);
    if (!isValidStart || !isValidEnd) {
      return false;
    }
  }
  return true;
}, 'Một hoặc nhiều khung giờ bán có định dạng không hợp lệ. Vui lòng dùng định dạng "HH:mm".');

// Virtual `totalStock`
productSchema.virtual('totalStock').get(function() {
  if (this.variantTable && this.variantTable.length > 0) {
    return this.variantTable.reduce((sum, variant) => sum + (variant.stock || 0), 0);
  }
  return this.stock || 0;
});

module.exports = mongoose.model('Product', productSchema);


