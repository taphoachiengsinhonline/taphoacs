const express = require('express');
const router = express.Router();
const Product = require('../models/Product');

// GET all products hoặc theo category
router.get('/products', async (req, res) => {
  try {
    const { category } = req.query;
    let filter = {};
    if (category) {
      filter.category = category;
    }

    const products = await Product.find(filter);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
