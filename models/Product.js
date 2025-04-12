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
});

module.exports = mongoose.model('Product', productSchema);
