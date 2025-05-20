const express = require('express');
const router = express.Router();
const { isAdminMiddleware } = require('../middlewares/authMiddleware');
const Category = require('../models/Category');

// Lấy tất cả danh mục
// Trong categoryRoutes.js
router.get('/', async (req, res) => {
  try {
    const categories = await Category.find().populate('parent', 'name');
    res.json(Array.isArray(categories) ? categories : []); // Luôn trả về mảng
  } catch (err) {
    res.status(500).json([]); // Trả về mảng rỗng khi có lỗi
  }
});

// Tạo danh mục
router.post('/', isAdminMiddleware, async (req, res) => {
  try {
    const { name, parent } = req.body;
    
    // Validate name
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ message: 'Tên danh mục phải từ 2 ký tự' });
    }

    // Check trùng name
    const existing = await Category.findOne({ name: name.trim() });
    if (existing) {
      return res.status(409).json({ message: 'Danh mục đã tồn tại' });
    }
    const newCategory = await Category.create({ name, parent: parent || null });
    res.status(201).json(newCategory);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server khi tạo danh mục' });
  }
});

// Xoá danh mục + danh mục con
router.delete('/:id', isAdminMiddleware, async (req, res) => {
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

