// productRoutes.js
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

    req.user = user;
    next();
  } catch (err) {
    console.error('❌ Lỗi xác thực admin:', err);
    res.status(500).json({ message: 'Lỗi server khi kiểm tra quyền admin' });
  }
};

// 👉 Hàm đệ quy lấy tất cả category con
const getAllChildCategoryIds = async (parentId) => {
  const children = await Category.find({ parent: parentId }).select('_id');
  let allChildIds = children.map(c => c._id.toString());

  for (const child of children) {
    const subChildren = await getAllChildCategoryIds(child._id);
    allChildIds = allChildIds.concat(subChildren);
  }

  return allChildIds;
};

// ✅ GET /api/products?category=ID
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;

    let filter = {};
    if (category && category !== 'Tất cả') {
      const categoryIds = [category, ...(await getAllChildCategoryIds(category))];
      filter.category = { $in: categoryIds };
    }

    const products = await Product.find(filter).populate('category');
    res.json(products);
  } catch (err) {
    console.error('❌ Lỗi khi lấy sản phẩm:', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ POST /api/products - Thêm sản phẩm mới (chỉ admin)
router.post('/', isAdmin, async (req, res) => {
  try {
    const { name, price, category, image } = req.body;
    console.log('📦 Thông tin sản phẩm nhận được:', req.body);
    if (!name || !price || !category) {
      return res.status(400).json({ message: 'Vui lòng nhập đầy đủ thông tin sản phẩm' });
    }

    const newProduct = new Product({
      name,
      price,
      category,
      image,
    });

    const saved = await newProduct.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error('❌ Lỗi khi thêm sản phẩm:', err);
    res.status(500).json({ message: 'Lỗi server khi thêm sản phẩm' });
  }
});

// ✅ DELETE /api/products/:id - Xoá sản phẩm (chỉ admin)
router.delete('/:id', isAdmin, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });
    res.json({ message: 'Đã xoá sản phẩm thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

module.exports = router;
