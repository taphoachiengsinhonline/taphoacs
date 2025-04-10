const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  price: { type: Number, required: true }, // Giá mặc định
  stock: { type: Number, required: true },
  attributes: [
    {
      name: { type: String, required: true }, // VD: "Dung lượng", "Size"
      options: [
        {
          value: { type: String, required: true }, // VD: "4GB", "8GB"
          price: { type: Number, required: true }  // Giá riêng cho mỗi lựa chọn
        }
      ]
    }
  ]
});

module.exports = mongoose.model('Product', productSchema);
