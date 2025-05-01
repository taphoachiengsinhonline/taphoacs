// routes/categoryRoutes.js
const express = require('express');
const router = express.Router();
const Category = require('../models/Category');

// Lấy tất cả danh mục
router.get('/', async (req, res) => {
  try {
    const categories = await Category.find().populate('parent', 'name');
    res.json(categories);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server khi lấy danh mục' });
  }
});

// Tạo danh mục
router.post('/', async (req, res) => {
  try {
    const { name, parent } = req.body;
    const existing = await Category.findOne({ name });
    if (existing) return res.status(400).json({ message: 'Danh mục đã tồn tại' });

    const newCategory = await Category.create({ name, parent: parent || null });
    res.status(201).json(newCategory);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server khi tạo danh mục' });
  }
});

// Xoá danh mục + danh mục con
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Category.deleteMany({ parent: id });
    await Category.findByIdAndDelete(id);
    res.json({ message: 'Đã xoá danh mục và danh mục con (nếu có)' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi xoá danh mục' });
  }
});

module.exports = router;

