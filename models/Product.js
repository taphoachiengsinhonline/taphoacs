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
    required: true,
    min: 0
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
  // Ví dụ thêm trường tồn kho
  stock: {
    type: Number,
    default: 0,
    min: 0
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

module.exports = mongoose.model('Product', productSchema);
