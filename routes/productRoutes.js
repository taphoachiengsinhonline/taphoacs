const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');

// Middleware kiểm tra admin
const isAdmin = async (req, res, next) => {
  try {
    const userId = req.header('x-user-id'); // Bạn có thể thay bằng xác thực JWT hoặc token khác nếu có

    if (!userId) {
      return res.status(401).json({ message: 'Không có user ID' });
    }

    const user = await User.findById(userId);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ message: 'Không có quyền admin' });
    }

    next();
  } catch (err) {
    res.status(500).json({ error: 'Lỗi xác thực admin' });
  }
};

// GET /products?category=ID
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

// ✅ POST /products - Thêm sản phẩm mới
router.post('/products', isAdmin, async (req, res) => {
  try {
    const { name, price, category, image } = req.body;

    if (!name || !price || !category) {
      return res.status(400).json({ message: 'Thiếu thông tin sản phẩm' });
    }

    const newProduct = new Product({
      name,
      price,
      category,
      image, // có thể là URL ảnh
    });

    const savedProduct = await newProduct.save();
    res.status(201).json(savedProduct);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi thêm sản phẩm' });
  }
});

module.exports = router;
