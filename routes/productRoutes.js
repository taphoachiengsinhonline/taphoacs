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

// SỬA LẠI TOÀN BỘ HÀM NÀY
// GET /api/products?category=ID
router.get('/', async (req, res) => {
  try {
    const { category, limit, sellerId } = req.query;
    
    // Bắt đầu với filter cơ bản: chỉ lấy sản phẩm đã được duyệt
    let filter = { approvalStatus: 'approved' }; 

    // Nếu có sellerId, đây là request từ trang của một người bán cụ thể
    // Ta sẽ bỏ qua điều kiện duyệt và chỉ lấy sản phẩm của seller đó
    if (sellerId) {
        filter = { seller: sellerId }; // Ghi đè filter, không cần check approvalStatus
    }

    // Nếu có category (và không phải từ trang seller), thêm điều kiện lọc category
    if (category && category !== 'Tất cả' && !sellerId) {
      const ids = [category, ...(await getAllChildCategoryIds(category))];
      filter.category = { $in: ids };
    }

    // Nếu không có sellerId, thì đây là trang chủ chung, nên không hiển thị sản phẩm trong kho = 0
    if (!sellerId) {
        filter.stock = { $gt: 0 }; // Chỉ hiển thị sản phẩm còn hàng
    }
    
    let query = Product.find(filter).populate('category').sort({ createdAt: -1 });

    if (limit) {
      query = query.limit(parseInt(limit));
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

router.post('/', verifyToken, async (req, res) => { // Bỏ isAdmin đi
  try {
    const { name, price, stock, category, description, attributes, images, saleStartTime, saleEndTime } = req.body;
    console.log('📦 Thông tin sản phẩm nhận được:', req.body);
    if (!name || price == null || !category || stock == null || !images?.length) {
      return res.status(400).json({ message: 'Vui lòng nhập đầy đủ thông tin sản phẩm' });
    }

    // Tự động gán người đăng là seller
    const newProduct = new Product({
      name, price, stock, category, description, attributes, images,
      saleStartTime, saleEndTime,
      seller: req.user._id, // QUAN TRỌNG: Gán người đăng nhập làm seller
      approvalStatus: 'pending_approval' // QUAN TRỌNG: Mặc định là chờ duyệt
    });

    const saved = await newProduct.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error('❌ Lỗi khi thêm sản phẩm:', err);
    res.status(500).json({ message: 'Lỗi server khi thêm sản phẩm' });
  }
});

router.put('/:id', verifyToken, async (req, res) => { // Bỏ isAdminMiddleware
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });

    // Chỉ admin hoặc chủ sản phẩm mới được sửa
    if (req.user.role !== 'admin' && product.seller.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Bạn không có quyền sửa sản phẩm này.' });
    }

    const updateFields = ['name', 'price', 'stock', 'category', 'description', 'attributes', 'images', 'saleStartTime', 'saleEndTime'];
    const updateData = {};
    for (const f of updateFields) {
      if (req.body[f] !== undefined) updateData[f] = req.body[f];
    }

    // Nếu người sửa không phải admin, reset trạng thái duyệt
    if (req.user.role !== 'admin') {
        updateData.approvalStatus = 'pending_approval';
    }
    
    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );
    
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
router.delete('/:id', verifyToken, async (req, res) => { // Bỏ isAdmin
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });

        // Chỉ admin hoặc chủ sản phẩm mới được xóa
        if (req.user.role !== 'admin' && product.seller.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Bạn không có quyền xóa sản phẩm này.' });
        }

        await Product.findByIdAndDelete(req.params.id);
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
