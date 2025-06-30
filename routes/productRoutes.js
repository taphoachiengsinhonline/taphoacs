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
    
    let filter = { approvalStatus: 'approved' }; 

    if (sellerId) {
        filter = { seller: sellerId };
    }

    if (category && category !== 'Tất cả' && !sellerId) {
      const ids = [category, ...(await getAllChildCategoryIds(category))];
      filter.category = { $in: ids };
    }
    
    if (!sellerId) {
        filter.stock = { $gt: 0 };
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

router.post('/', verifyToken, async (req, res) => { // Bỏ isAdmin đi để seller có thể đăng
  try {
    const { 
        name, price, stock, category, description, images, 
        saleStartTime, saleEndTime, barcode, weight, 
        variantGroups, variantTable 
    } = req.body;
    
    console.log('📦 Backend nhận được sản phẩm:', req.body);

    // --- VALIDATION PHÍA BACKEND ---
    if (!name || !category || !images?.length || !weight) {
      return res.status(400).json({ message: 'Thiếu thông tin cơ bản: Tên, danh mục, ảnh, trọng lượng.' });
    }

    if (variantTable && variantTable.length > 0) {
        // Nếu có phân loại, không cần price và stock ở cấp gốc
        // Backend có thể thêm validation cho từng variant ở đây nếu muốn
    } else {
        // Nếu không có phân loại, price và stock là bắt buộc
        if (price == null || stock == null) {
            return res.status(400).json({ message: 'Sản phẩm không có phân loại phải có giá và kho.' });
        }
    }
    
    const newProduct = new Product({
      name,
      price, // Sẽ là null nếu có phân loại
      stock, // Sẽ là null nếu có phân loại
      category,
      description,
      images,
      saleStartTime,
      saleEndTime,
      barcode,
      weight,
      variantGroups,
      variantTable,
      seller: req.user._id, // Lấy từ token, không phải từ body
      approvalStatus: 'pending_approval' // Luôn là chờ duyệt khi tạo mới
    });
    
    const saved = await newProduct.save();
    res.status(201).json(saved);

  } catch (err) {
    console.error('❌ Lỗi khi thêm sản phẩm:', err);
    // Cung cấp thông báo lỗi chi tiết hơn nếu có lỗi từ Mongoose
    if (err.name === 'ValidationError') {
        return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: 'Lỗi server khi thêm sản phẩm' });
  }
});

router.put('/:id', verifyToken, async (req, res) => {
  try {
    // BƯỚC 1: LẤY SẢN PHẨM HIỆN TẠI TỪ DB
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });
    }

    // BƯỚC 2: KIỂM TRA QUYỀN SỞ HỮU
    if (req.user.role !== 'admin' && product.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Bạn không có quyền sửa sản phẩm này.' });
    }

    // BƯỚC 3: LƯU LẠI CÁC TRƯỜNG QUAN TRỌNG ĐỂ SO SÁNH
    const oldValues = {
      name: product.name,
      description: product.description,
      category: product.category,
      images: JSON.stringify(product.images.sort()), // Sắp xếp để so sánh mảng
    };

    // BƯỚC 4: NHẬN DỮ LIỆU MỚI TỪ REQUEST
    const { 
        name, price, stock, category, description, images, 
        saleStartTime, saleEndTime, barcode, weight, 
        variantGroups, variantTable 
    } = req.body;

    // BƯỚC 5: CẬP NHẬT DỮ LIỆU VÀO DOCUMENT
    product.name = name;
    product.description = description;
    product.images = images;
    product.saleStartTime = saleStartTime;
    product.saleEndTime = saleEndTime;
    product.barcode = barcode;
    product.weight = weight;
    product.category = category;
    product.variantGroups = variantGroups;
    product.variantTable = variantTable;
    
    // Áp dụng logic giá và kho tùy theo có phân loại hay không
    if (variantTable && variantTable.length > 0) {
      product.price = undefined; // Để Mongoose không cập nhật trường này
      product.stock = undefined; // Để Mongoose không cập nhật trường này
    } else {
      product.price = price;
      product.stock = stock;
    }

    // BƯỚC 6: LOGIC PHÊ DUYỆT LẠI THÔNG MINH
    if (req.user.role === 'seller') {
      // So sánh các trường quan trọng
      const hasSignificantChange = 
        product.name !== oldValues.name ||
        product.description !== oldValues.description ||
        product.category !== oldValues.category ||
        JSON.stringify(product.images.sort()) !== oldValues.images;

      // Nếu có thay đổi quan trọng, chuyển về trạng thái chờ duyệt
      if (hasSignificantChange) {
        product.approvalStatus = 'pending_approval';
        product.rejectionReason = ''; // Xóa lý do từ chối cũ (nếu có)
        console.log(`[Product Update] Seller ${req.user._id} đã thay đổi thông tin quan trọng của sản phẩm ${product._id}. Chuyển về chờ duyệt.`);
      } else {
        console.log(`[Product Update] Seller ${req.user._id} chỉ thay đổi giá/kho của sản phẩm ${product._id}. Không cần duyệt lại.`);
      }
    }

    // BƯỚC 7: LƯU DOCUMENT VÀO DB
    const updatedProduct = await product.save();
    
    res.json(updatedProduct);

  } catch (err) {
    console.error('❌ Lỗi khi cập nhật sản phẩm:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: err.message });
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
