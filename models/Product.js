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
    // Chỉ bắt buộc khi không có phân loại
    required: function() {
      // `this` ở đây là document đang được validate
      return !this.variantTable || this.variantTable.length === 0;
    },
    min: 0
  },
  stock: {
    type: Number,
    // Chỉ bắt buộc khi không có phân loại
    required: function() {
      return !this.variantTable || this.variantTable.length === 0;
    },
    min: 0,
    default: 0
  },
  // Khung giờ bán lặp lại mỗi ngày, định dạng "HH:mm"
  saleStartTime: {
    type: String,
    default: null
  },
  saleEndTime: {
    type: String,
    default: null
  },
 
  // Ví dụ phân loại
  category: {
    type: String,
    default: 'general'
  },

  weight: { // <-- THÊM MỚI
    type: Number, // In grams
    default: 0
  },
   barcode: { // <-- THÊM MỚI
    type: String,
    trim: true,
    default: ''
  },
  // THÊM MỚI TOÀN BỘ PHẦN PHÂN LOẠI
  variantGroups: [{
    name: String, // VD: "Màu sắc"
    options: [String] // VD: ["Đỏ", "Xanh"]
  }],
  variantTable: [{
    combination: String, // VD: "Đỏ-S"
    price: Number,
    stock: Number,
    sku: String
  }],
    
  createdBy: { // Thêm field liên kết với seller (hiện là admin)
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
rejectionReason: { // Lý do từ chối (nếu có)
    type: String
}
  
}, {
  timestamps: true
});

// Optional: validate định dạng "HH:mm"
productSchema.path('saleStartTime').validate(function(v) {
  return v === null || /^\d{2}:\d{2}$/.test(v);
}, 'saleStartTime phải có định dạng "HH:mm"');

productSchema.path('saleEndTime').validate(function(v) {
  return v === null || /^\d{2}:\d{2}$/.test(v);
}, 'saleEndTime phải có định dạng "HH:mm"');



productSchema.virtual('totalStock').get(function() {
  // `this` ở đây là document sản phẩm
  if (this.variantTable && this.variantTable.length > 0) {
    // Nếu có phân loại, tính tổng stock từ các biến thể
    return this.variantTable.reduce((sum, variant) => sum + (variant.stock || 0), 0);
  }
  // Nếu không, trả về stock ở cấp gốc
  return this.stock || 0;
});

// Đảm bảo trường ảo được bao gồm khi chuyển đổi sang JSON/Object
productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Product', productSchema);
