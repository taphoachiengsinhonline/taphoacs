// backend/controllers/productController.js

const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { safeNotify } = require('../utils/notificationMiddleware'); // Đường dẫn có thể cần sửa lại thành ../utils/

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

// Lấy danh sách sản phẩm
exports.getAllProducts = async (req, res) => {
  try {
    const { category, limit, sellerId } = req.query;
    
    let filter = {}; 

    if (sellerId) {
        filter = { seller: sellerId };
    } else {
        filter = { approvalStatus: 'approved' };
    }

    if (category && category !== 'Tất cả' && !sellerId) {
      const ids = [category, ...(await getAllChildCategoryIds(category))];
      filter.category = { $in: ids };
    }
    
    let query = Product.find(filter).populate('category').sort({ createdAt: -1 });

    if (limit) {
      query = query.limit(parseInt(limit));
    }

    let products = await query;

    if (!sellerId) {
        products = products.filter(p => p.totalStock > 0);
    }
    
    res.json(products);
  } catch (err) {
    console.error('❌ Lỗi khi lấy sản phẩm:', err);
    res.status(500).json({ error: err.message });
  }
};

// Lấy chi tiết một sản phẩm
exports.getProductById = async (req, res) => {
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
};

// Tạo sản phẩm mới
exports.createProduct = async (req, res) => {
  try {
    const { 
        name, price, stock, category, description, images, 
        saleStartTime, saleEndTime, barcode, weight, 
        variantGroups, variantTable 
    } = req.body;
    
    console.log('📦 Backend nhận được sản phẩm:', req.body);

    if (!name || !category || !images?.length || !weight) {
      return res.status(400).json({ message: 'Thiếu thông tin cơ bản: Tên, danh mục, ảnh, trọng lượng.' });
    }

    if (variantTable && variantTable.length > 0) {
        // Validation cho variant
    } else {
        if (price == null || stock == null) {
            return res.status(400).json({ message: 'Sản phẩm không có phân loại phải có giá và kho.' });
        }
    }
    
    const newProduct = new Product({
      name, price, stock, category, description, images,
      saleStartTime, saleEndTime, barcode, weight,
      variantGroups, variantTable,
      seller: req.user._id,
      approvalStatus: 'pending_approval'
    });
    
    const savedProduct = await newProduct.save();

    // Gửi thông báo cho Admin
    (async () => {
        try {
            const seller = await User.findById(req.user._id).select('name');
            const admins = await User.find({ role: 'admin', fcmToken: { $exists: true, $ne: null } });
            if (admins.length > 0) {
                const title = "Sản phẩm mới chờ duyệt";
                const body = `${seller.name} vừa đăng sản phẩm mới: "${savedProduct.name}".`;
                const notifications = admins.map(admin => ({
                    user: admin._id, title, message: body, type: 'product',
                    data: { productId: savedProduct._id.toString(), screen: 'ProductApproval' }
                }));
                await Notification.insertMany(notifications);
                for (const admin of admins) {
                    await safeNotify(admin.fcmToken, {
                        title, body,
                        data: { productId: savedProduct._id.toString(), screen: 'ProductApproval' }
                    });
                }
                console.log(`[Product] Đã gửi thông báo duyệt sản phẩm đến ${admins.length} admin.`);
            }
        } catch (notificationError) {
            console.error("[Product] Lỗi khi gửi thông báo cho admin:", notificationError);
        }
    })();

    res.status(201).json(savedProduct);

  } catch (err) {
    console.error('❌ Lỗi khi thêm sản phẩm:', err);
    if (err.name === 'ValidationError') {
        return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: 'Lỗi server khi thêm sản phẩm' });
  }
};

// Cập nhật sản phẩm
exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });
    }

    if (req.user.role !== 'admin' && product.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Bạn không có quyền sửa sản phẩm này.' });
    }

    const oldValues = {
      name: product.name,
      description: product.description,
      category: product.category,
      images: JSON.stringify(product.images.sort()),
    };

    const { 
        name, price, stock, category, description, images, 
        saleStartTime, saleEndTime, barcode, weight, 
        variantGroups, variantTable 
    } = req.body;

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
    
    if (variantTable && variantTable.length > 0) {
      product.price = undefined;
      product.stock = undefined;
    } else {
      product.price = price;
      product.stock = stock;
    }

    if (req.user.role === 'seller') {
      const hasSignificantChange = 
        product.name !== oldValues.name ||
        product.description !== oldValues.description ||
        product.category !== oldValues.category ||
        JSON.stringify(product.images.sort()) !== oldValues.images;

      if (hasSignificantChange) {
        product.approvalStatus = 'pending_approval';
        product.rejectionReason = '';
        console.log(`[Product Update] Seller ${req.user._id} đã thay đổi thông tin quan trọng của sản phẩm ${product._id}. Chuyển về chờ duyệt.`);
      } else {
        console.log(`[Product Update] Seller ${req.user._id} chỉ thay đổi giá/kho của sản phẩm ${product._id}. Không cần duyệt lại.`);
      }
    }

    const updatedProduct = await product.save();
    res.json(updatedProduct);

  } catch (err) {
    console.error('❌ Lỗi khi cập nhật sản phẩm:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: 'Lỗi server khi cập nhật sản phẩm' });
  }
};

// Xóa sản phẩm
exports.deleteProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });

        if (req.user.role !== 'admin' && product.seller.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Bạn không có quyền xóa sản phẩm này.' });
        }

        await Product.findByIdAndDelete(req.params.id);
        res.json({ message: 'Đã xoá sản phẩm thành công' });
    } catch (err) {
    console.error('❌ Lỗi khi xoá sản phẩm:', err);
    res.status(500).json({ message: 'Lỗi server khi xoá sản phẩm' });
  }
};
