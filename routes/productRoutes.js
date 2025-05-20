// productRoutes.js
const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');

// Middleware kiểm tra quyền admin
tconst isAdmin = async (req, res, next) => {
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

// Hàm đệ quy lấy danh sách category con
tconst getAllChildCategoryIds = async (parentId) => {
  const children = await Category.find({ parent: parentId }).select('_id');
  let allIds = children.map(c => c._id.toString());
  for (const c of children) {
    const sub = await getAllChildCategoryIds(c._id);
    allIds = allIds.concat(sub);
  }
  return allIds;
};

// GET /api/products?category=ID
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    let filter = {};
    if (category && category !== 'Tất cả') {
      const ids = [category, ...(await getAllChildCategoryIds(category))];
      filter.category = { $in: ids };
    }
    const products = await Product.find(filter).populate('category');
    res.json(products);
  } catch (err) {
    console.error('❌ Lỗi khi lấy sản phẩm:', err);
    res.status(500).json({ error: err.message });
  }
});


router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('category');
    if (!product) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });
    }
    res.json(product);
  } catch (err) {
    console.error('❌ Lỗi khi lấy chi tiết sản phẩm:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});



// POST /api/products - Thêm sản phẩm mới (chỉ admin)
router.post('/', isAdmin, async (req, res) => {
  try {
    const { name, price, stock, category, description, attributes, images, saleStartTime, saleEndTime } = req.body;
    console.log('📦 Thông tin sản phẩm nhận được:', req.body);
    if (!name || price == null || !category || stock == null || !images?.length) {
      return res.status(400).json({ message: 'Vui lòng nhập đầy đủ thông tin sản phẩm' });
    }
    const newProduct = new Product({
      name,
      price,
      stock,
      category,
      description,
      attributes,
      images,
      saleStartTime,
      saleEndTime,
      createdBy: req.user._id
    });
    const saved = await newProduct.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error('❌ Lỗi khi thêm sản phẩm:', err);
    res.status(500).json({ message: 'Lỗi server khi thêm sản phẩm' });
  }
});

// PUT /api/products/:id - Cập nhật sản phẩm (chỉ admin)
router.put('/:id', isAdmin, async (req, res) => {
  try {
    const updateFields = ['name','price','stock','category','description','attributes','images','saleStartTime','saleEndTime'];
    const updateData = {};
    for (const f of updateFields) {
      if (req.body[f] !== undefined) updateData[f] = req.body[f];
    }
    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });
    res.json(updated);
  } catch (err) {
    console.error('❌ Lỗi khi cập nhật sản phẩm:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: err.message });
    }
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'ID sản phẩm không hợp lệ' });
    }
    res.status(500).json({ message: 'Lỗi server khi cập nhật sản phẩm' });
  }
});

// DELETE /api/products/:id - Xoá sản phẩm (chỉ admin)
router.delete('/:id', isAdmin, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });
    res.json({ message: 'Đã xoá sản phẩm thành công' });
  } catch (err) {
    console.error('❌ Lỗi khi xoá sản phẩm:', err);
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'ID sản phẩm không hợp lệ' });
    }
    res.status(500).json({ message: 'Lỗi server khi xoá sản phẩm' });
  }
});

module.exports = router;
