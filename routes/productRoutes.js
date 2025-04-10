const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');

// Middleware kiểm tra quyền admin
const isAdmin = async (req, res, next) => {
  try {
    const userId = req.header('x-user-id');

    if (!userId) {
      return res.status(401).json({ message: 'Không có user ID trong header' });
    }

    const user = await User.findById(userId);

    if (!user || !user.isAdmin) {
      return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này' });
    }

    req.user = user; // lưu user vào req để các middleware khác dùng nếu cần
    next();
  } catch (err) {
    console.error('❌ Lỗi xác thực admin:', err);
    res.status(500).json({ message: 'Lỗi server khi kiểm tra quyền admin' });
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

// ✅ POST /products - Thêm sản phẩm mới (chỉ admin)
router.post('/products', isAdmin, async (req, res) => {
  try {
    const { name, price, category, image } = req.body;

    if (!name || !price || !category) {
      return res.status(400).json({ message: 'Vui lòng nhập đầy đủ thông tin sản phẩm' });
    }

    const newProduct = new Product({
      name,
      price,
      category,
      image, // ảnh là URL, sẽ hiển thị ở frontend
    });

    const saved = await newProduct.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error('❌ Lỗi khi thêm sản phẩm:', err);
    res.status(500).json({ message: 'Lỗi server khi thêm sản phẩm' });
  }
});

module.exports = router;
