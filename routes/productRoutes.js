// productRoutes.js
const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');

// Middleware kiểm tra quyền admin
const { verifyToken, isAdmin, isAdminMiddleware } = require('../middlewares/authMiddleware');

// Hàm đệ quy lấy danh sách category con
const getAllChildCategoryIds = async (parentId) => {
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
    const { category, limit } = req.query;
    let filter = {};
    if (category && category !== 'Tất cả') {
      const ids = [category, ...(await getAllChildCategoryIds(category))];
      filter.category = { $in: ids };
    }
    let query = Product.find(filter).populate('category');
    if (limit) {
      query = query.limit(parseInt(limit)); // Giới hạn số lượng sản phẩm
    }
    const products = await query;
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
router.post('/', verifyToken, isAdmin, async (req, res) => {
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
      createdBy: req.user._id // Gán admin làm seller tạm thời
    });
    const saved = await newProduct.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error('❌ Lỗi khi thêm sản phẩm:', err);
    res.status(500).json({ message: 'Lỗi server khi thêm sản phẩm' });
  }
});

// PUT /api/products/:id - Cập nhật sản phẩm (chỉ admin)
router.put('/:id', verifyToken, isAdminMiddleware, async (req, res) => {
  try {
    const updateFields = ['name', 'price', 'stock', 'category', 'description', 'attributes', 'images', 'saleStartTime', 'saleEndTime', 'createdBy'];
    const updateData = {};
    for (const f of updateFields) {
      if (req.body[f] !== undefined) updateData[f] = req.body[f];
    }
    // Nếu createdBy không có, giữ nguyên giá trị cũ hoặc gán mặc định
    if (!updateData.createdBy && req.user) {
      updateData.createdBy = req.user._id;
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
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    console.log('Deleting product with id:', req.params.id);
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });
    console.log('Deleted by admin:', req.user.email); // Thêm log kiểm tra
    res.json({ message: 'Đã xoá sản phẩm thành công' });
  } catch (err) {
    console.error('❌ Lỗi khi xoá sản phẩm:', err);
    res.status(500).json({ message: 'Lỗi server khi xoá sản phẩm' });
  }
});


// Thêm endpoint mới
router.get('/', async (req, res) => {
  try {
    const { sellerId } = req.query;
    let query = {};
    
    if (sellerId) {
      query.createdBy = sellerId;
    }
    
    const products = await Product.find(query)
      .sort({ createdAt: -1 })
      .limit(20);
    
    res.json(products);
  } catch (err) {
    console.error('[Products] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});



module.exports = router;
