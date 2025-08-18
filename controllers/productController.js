const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { safeNotify } = require('../utils/notificationMiddleware');
const Order = require('../models/Order');
const mongoose = require('mongoose');

const getAllChildCategoryIds = async (parentId) => {
    const children = await Category.find({ parent: parentId }).select('_id');
    let allIds = children.map(c => c._id.toString());
    for (const c of children) {
        const sub = await getAllChildCategoryIds(c._id);
        allIds = allIds.concat(sub);
    }
    return allIds;
};


// HÀM getAllProducts SỬA LẠI HOÀN CHỈNH
exports.getAllProducts = async (req, res) => {
  try {
    const { category, limit, sellerId } = req.query;

    let filter = {}; 

    if (!sellerId) {
        filter.approvalStatus = 'approved';
    } else {
        filter.seller = sellerId;
    }

    if (category && category !== 'Tất cả') {
      const childIds = await getAllChildCategoryIds(category);
      const allIds_String = [category, ...childIds];
      
      const allIds_ObjectId = allIds_String
        .filter(id => mongoose.Types.ObjectId.isValid(id))
        .map(id => new mongoose.Types.ObjectId(id));

      // DÙNG $or ĐỂ TÌM CẢ KIỂU STRING VÀ OBJECTID
      // Đây là mấu chốt để sửa lỗi không nhất quán dữ liệu
      filter.$or = [
          { category: { $in: allIds_String } },
          { category: { $in: allIds_ObjectId } }
      ];
    }
    
    // Câu query bây giờ sẽ tìm các sản phẩm có `approvalStatus` VÀ (`category` là String HOẶC `category` là ObjectId)
    let query = Product.find(filter)
        .populate('category') // Giữ lại populate, nó an toàn khi dùng với .lean()
        .sort({ createdAt: -1 });

    if (limit) {
      query = query.limit(parseInt(limit));
    }

    // Dùng .lean() để tối ưu hiệu suất
    let products = await query.lean().exec();
    
    // Lọc tồn kho (chỉ cho app khách hàng)
    if (!sellerId) {
        // Viết lại logic tính tổng stock để hoạt động với .lean()
        products = products.filter(p => {
            let totalStock = 0;
            if (p.variantTable && p.variantTable.length > 0) {
                totalStock = p.variantTable.reduce((sum, variant) => sum + (variant.stock || 0), 0);
            } else {
                totalStock = p.stock || 0;
            }
            const needsConsultation = p.requiresConsultation === true;
            return totalStock > 0 || needsConsultation;
        });
    }
    
    res.json(products);

  } catch (err) {
    console.error('❌ Lỗi khi lấy sản phẩm:', err);
    res.status(500).json({ error: err.message });
  }
};

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

exports.getBestSellers = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 10;
        const bestSellers = await Order.aggregate([
            { $match: { status: 'Đã giao' } },
            { $unwind: '$items' },
            { $group: { _id: '$items.productId', totalQuantitySold: { $sum: '$items.quantity' } } },
            { $sort: { totalQuantitySold: -1 } },
            { $limit: limit },
            { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'productDetails' } },
            { $unwind: '$productDetails' },
            { $replaceRoot: { newRoot: '$productDetails' } }
        ]);
        res.json(bestSellers);
    } catch (err) {
        console.error('❌ Lỗi khi lấy sản phẩm bán chạy:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
};

exports.createProduct = async (req, res) => {
  try {
    const { 
        name, price, stock, category, description, images, 
        saleTimeFrames, barcode, weight, 
        variantGroups, variantTable, requiresConsultation
    } = req.body;
    
    if (!name || !category || !images?.length || !weight) {
      return res.status(400).json({ message: 'Thiếu thông tin cơ bản: Tên, danh mục, ảnh, trọng lượng.' });
    }

    if (!requiresConsultation) {
        if (variantTable && variantTable.length > 0) {
        } else {
            if (price == null || stock == null) {
                return res.status(400).json({ message: 'Sản phẩm không cần tư vấn phải có giá và kho.' });
            }
        }
    }
    
    const newProduct = new Product({
      name,
      price: requiresConsultation || (variantTable && variantTable.length > 0) ? undefined : price,
      stock: requiresConsultation || (variantTable && variantTable.length > 0) ? undefined : stock,
      category, description, images, saleTimeFrames, barcode, weight,
      variantGroups, variantTable, requiresConsultation,
      seller: req.user._id,
      approvalStatus: 'pending_approval'
    });
    
    const savedProduct = await newProduct.save();

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
        saleTimeFrames, barcode, weight, 
        variantGroups, variantTable, requiresConsultation
    } = req.body;

    product.name = name;
    product.description = description;
    product.images = images;
    product.saleTimeFrames = saleTimeFrames;
    product.barcode = barcode;
    product.weight = weight;
    product.category = category;
    product.variantGroups = variantGroups;
    product.variantTable = variantTable;
    product.requiresConsultation = requiresConsultation;
    
    if (requiresConsultation || (variantTable && variantTable.length > 0)) {
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
        product.category.toString() !== oldValues.category.toString() ||
        JSON.stringify(product.images.sort()) !== oldValues.images;

      if (hasSignificantChange) {
        product.approvalStatus = 'pending_approval';
        product.rejectionReason = '';
        console.log(`[Product Update] Seller ${req.user._id} đã thay đổi thông tin quan trọng. Chuyển về chờ duyệt.`);
      } else {
        console.log(`[Product Update] Seller ${req.user._id} chỉ thay đổi thông tin không quan trọng. Không cần duyệt lại.`);
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

exports.getProductRecommendations = async (req, res) => {
    try {
        const { id: productId } = req.params;
        const limit = parseInt(req.query.limit, 10) || 8;
        const currentProduct = await Product.findById(productId).lean();
        if (!currentProduct) { return res.status(404).json({ message: "Sản phẩm không tồn tại." }); }
        const ordersWithProduct = await Order.find({ 'items.productId': productId, status: 'Đã giao' }, 'items.productId').limit(200).lean();
        let companionProductIds = {};
        if (ordersWithProduct.length > 0) {
            ordersWithProduct.forEach(order => {
                const productIdsInOrder = order.items.map(item => item.productId.toString());
                if (productIdsInOrder.length > 1) {
                    productIdsInOrder.forEach(id => {
                        if (id !== productId) { companionProductIds[id] = (companionProductIds[id] || 0) + 1; }
                    });
                }
            });
        }
        let recommendedIds = Object.entries(companionProductIds).sort(([, a], [, b]) => b - a).map(([id]) => new mongoose.Types.ObjectId(id));
        let recommendations = [];
        if (recommendedIds.length > 0) {
            recommendations = await Product.find({ _id: { $in: recommendedIds }, approvalStatus: 'approved' }).lean();
        }
        if (recommendations.length < limit && currentProduct.category) {
            const additionalProducts = await Product.find({
                category: currentProduct.category,
                _id: { $nin: [productId, ...recommendedIds] },
                approvalStatus: 'approved'
            }).limit(limit - recommendations.length).lean();
            recommendations = [...recommendations, ...additionalProducts];
        }
        const finalRecommendations = recommendations
            .filter((p, index, self) => index === self.findIndex((t) => t._id.toString() === p._id.toString()))
            .filter(p => p.totalStock > 0 || p.requiresConsultation === true); // Sửa thêm ở đây
        res.json(finalRecommendations);
    } catch (error) {
        console.error('❌ Lỗi khi lấy sản phẩm gợi ý:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
};
