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
      filter.category = category; // category là _id dạng chuỗi
    }

    const products = await Product.find(filter);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

