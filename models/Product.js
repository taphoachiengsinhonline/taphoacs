const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  description: { type: String, default: '' },
  images: [String], // ✅ Thay vì image: String
  price: { type: Number, required: true },
  stock: { type: Number, required: true },
  attributes: [
    {
      name: { type: String, required: true },
      options: [
        {
          value: { type: String, required: true },
          price: { type: Number, required: true }
        }
      ]
    }
  ]
saleStartTime: { type: String, default: null },  // ví dụ "09:00"
  saleEndTime:   { type: String, default: null }   // ví dụ "17:30"
}, {
  timestamps: true
});

module.exports = mongoose.model('Product', productSchema);
