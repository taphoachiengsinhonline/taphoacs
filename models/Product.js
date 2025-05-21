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
 // category: {
 //   type: String,
 //   default: 'general'
 // },


category: {
  type: mongoose.Schema.Types.ObjectId, // Sửa từ String sang ObjectId
  ref: 'Category',
  required: true
},


  
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
