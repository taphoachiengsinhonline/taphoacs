const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Category = require('../models/Category');

// GET /products?category=TênDanhMục
router.get('/products', async (req, res) => {
  try {
    const { category } = req.query;
    let filter = {};

    if (category && category !== 'Tất cả') {
      const foundCategory = await Category.findOne({ name: category });
      if (!foundCategory) {
        return res.status(404).json({ error: 'Danh mục không tồn tại' });
      }
      filter.category = foundCategory._id;
    }

    const products = await Product.find(filter).populate('category'); // để client thấy tên danh mục
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
