// models/Category.js
const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true // Tự động xóa khoảng trắng thừa
  },
  parent: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Category', 
    default: null,
    validate: {
      // Đảm bảo parent tồn tại trong DB
      validator: async function(value) {
        if (!value) return true;
        const category = await mongoose.model('Category').findById(value);
        return !!category;
      },
      message: 'Danh mục cha không tồn tại'
    }
  }
});

module.exports = mongoose.model('Category', categorySchema);
