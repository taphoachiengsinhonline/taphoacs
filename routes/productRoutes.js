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
