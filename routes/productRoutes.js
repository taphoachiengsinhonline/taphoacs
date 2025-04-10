// routes/productRoutes.js
const express = require('express');
const router = express.Router();
const Product = require('../models/Product');

router.post('/products', async (req, res) => {
  try {
    const { name, category, quantity, price, variants } = req.body;
    const product = new Product({
      name,
      category,
      quantity,
      price,
      variants
    });
    await product.save();
    res.status(201).json(product);
  } catch (err) {
    console.error('Lỗi thêm sản phẩm:', err);
    res.status(500).json({ error: 'Lỗi khi thêm sản phẩm' });
  }
});

module.exports = router;
