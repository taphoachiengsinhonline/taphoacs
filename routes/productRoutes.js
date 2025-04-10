const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { isAdminMiddleware } = require('../middleware/authMiddleware'); // bạn cần có middleware này

router.post('/products', isAdminMiddleware, async (req, res) => {
  try {
    const { name, category, price, stock, attributes } = req.body;
    const newProduct = new Product({ name, category, price, stock, attributes });
    await newProduct.save();
    res.status(201).json(newProduct);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
// Lấy tất cả sản phẩm, có thể lọc theo danh mục
router.get('/products', async (req, res) => {
  try {
    const { category } = req.query;
    let filter = {};

    if (category && category !== 'Tất cả') {
      filter.category = category;
    }

    const products = await Product.find(filter);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
