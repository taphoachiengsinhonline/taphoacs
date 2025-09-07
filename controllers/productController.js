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
    
    let filter = { approvalStatus: 'approved' }; 

    if (sellerId) {
        filter.seller = sellerId;
    } else {
        // <<< SỬA LOGIC LỌC KHU VỰC >>>
        // Nếu người dùng đã đăng nhập VÀ có thông tin khu vực, thì mới lọc
        if (req.user && req.user.region) {
            filter.region = req.user.region;
        }
        // Nếu không (khách vãng lai), filter sẽ không có trường region,
        // do đó sẽ lấy sản phẩm từ tất cả các khu vực.
    }

    if (category && category !== 'Tất cả') {
      const ids = [category, ...(await getAllChildCategoryIds(category))];
      filter.category = { $in: ids };
    }
    
    let query = Product.find(filter)
      .populate('category')
      .select('+saleTimeFrames +totalStock') 
      .sort({ createdAt: -1 });

    if (limit) {
      query = query.limit(parseInt(limit));
    }

    let products = await query.exec();
    
    if (!sellerId) {
        products = products.filter(p => p.totalStock > 0 || p.requiresConsultation === true);
    }
    
    res.json(products);

  } catch (err) {
    console.error('❌ Lỗi khi lấy sản phẩm:', err);
    res.status(500).json({ error: err.message });
  }
};
exports.getProductById = async (req, res) => {
  try {
    // --- BẮT ĐẦU SỬA ĐỔI ---
    const product = await Product.findById(req.params.id)
        .populate('category')
        // Sửa lại chuỗi select để lấy đúng các trường cần thiết từ shopProfile
        .populate('seller', 'name shopProfile.avatar'); 
    // --- KẾT THÚC SỬA ĐỔI ---

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
        
        let matchStage = { status: 'Đã giao' };

        // <<< SỬA LOGIC LỌC KHU VỰC >>>
        if (req.user && req.user.region) {
            matchStage.region = new mongoose.Types.ObjectId(req.user.region);
        }
        
        const bestSellers = await Order.aggregate([
            { $match: matchStage }, // << Áp dụng bộ lọc
            { $unwind: '$items' },
            { $group: { _id: '$items.productId', totalQuantitySold: { $sum: '$items.quantity' } } },
            { $sort: { totalQuantitySold: -1 } },
            { $limit: limit },
            { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'productDetails' } },
            { $unwind: '$productDetails' },
            // Bước 2: Chỉ giữ lại các sản phẩm vẫn còn được duyệt
            { $match: { 'productDetails.approvalStatus': 'approved' } },
            { $replaceRoot: { newRoot: '$productDetails' } }
        ]);
        res.json(bestSellers);
    } catch (err) {
        console.error('❌ Lỗi khi lấy sản phẩm bán chạy:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
};


exports.getRelatedProducts = async (req, res) => {
    try {
        if (!req.user || !req.user.region) return res.json([]);
        const regionId = req.user.region;
        const { productId } = req.params;
        const limit = parseInt(req.query.limit, 10) || 6;

        const currentProduct = await Product.findById(productId).select('category').lean();
        if (!currentProduct || !currentProduct.category) {
            return res.json([]);
        }

        const relatedProducts = await Product.find({
            category: currentProduct.category,
            _id: { $ne: productId }, // Loại trừ chính sản phẩm đang xem
            approvalStatus: 'approved',
            region: regionId, // Lọc theo khu vực
            $or: [{ totalStock: { $gt: 0 } }, { requiresConsultation: true }]
        })
        .limit(limit)
        .lean();
        
        res.json(relatedProducts);
    } catch (error) {
        console.error('❌ Lỗi khi lấy sản phẩm liên quan:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
};

// --- HÀM 2: LẤY SẢN PHẨM THƯỜNG MUA CÙNG ---
exports.getAlsoBoughtProducts = async (req, res) => {
    try {
        if (!req.user || !req.user.region) return res.json([]);
        const regionId = req.user.region;
        const { productId } = req.params;
        const limit = parseInt(req.query.limit, 10) || 8;

        const ordersWithProduct = await Order.find({ 
            'items.productId': productId, 
            status: 'Đã giao',
            region: regionId
        }, 'items.productId').limit(200).lean();
        
        let companionProductIds = {};
        ordersWithProduct.forEach(order => {
            const productIdsInOrder = order.items.map(item => item.productId.toString());
            if (productIdsInOrder.length > 1) {
                productIdsInOrder.forEach(id => {
                    if (id !== productId) { companionProductIds[id] = (companionProductIds[id] || 0) + 1; }
                });
            }
        });

        const sortedIds = Object.entries(companionProductIds)
            .sort(([, a], [, b]) => b - a)
            .map(([id]) => new mongoose.Types.ObjectId(id));
        
        if (sortedIds.length === 0) {
            return res.json([]); // Không có ai mua cùng, trả về mảng rỗng
        }

        const alsoBoughtProducts = await Product.find({
            _id: { $in: sortedIds.slice(0, limit) },
            approvalStatus: 'approved',
            region: regionId,
            $or: [{ totalStock: { $gt: 0 } }, { requiresConsultation: true }]
        }).lean();

        res.json(alsoBoughtProducts);
    } catch (error) {
        console.error('❌ Lỗi khi lấy sản phẩm thường mua cùng:', error);
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
      region: req.user.region, // <<< KẾ THỪA REGION TỪ SELLER
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
      category: product.category.toString(),
      images: JSON.stringify(product.images.sort()),
      // Lưu lại giá trị cũ của saleTimeFrames để so sánh
      saleTimeFrames: JSON.stringify(product.saleTimeFrames), 
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
        product.category.toString() !== oldValues.category ||
        JSON.stringify(product.images.sort()) !== oldValues.images ||
        // Thêm điều kiện kiểm tra sự thay đổi của saleTimeFrames
        JSON.stringify(product.saleTimeFrames) !== oldValues.saleTimeFrames;

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
        if (!req.user || !req.user.region) {
            return res.json([]);
        }
        const regionId = req.user.region;
        const { id: productId } = req.params;
        const limit = parseInt(req.query.limit, 10) || 8;

        const currentProduct = await Product.findById(productId).lean();
        if (!currentProduct) { return res.status(404).json({ message: "Sản phẩm không tồn tại." }); }

        // Tìm các đơn hàng chứa sản phẩm này, trong cùng khu vực
        const ordersWithProduct = await Order.find({ 
            'items.productId': productId, 
            status: 'Đã giao',
            region: regionId // <<< LỌC THEO KHU VỰC
        }, 'items.productId').limit(200).lean();
        
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
            recommendations = await Product.find({ 
                _id: { $in: recommendedIds }, 
                approvalStatus: 'approved',
                region: regionId // <<< Đảm bảo sản phẩm gợi ý cũng trong khu vực
            }).lean();
        }

        if (recommendations.length < limit && currentProduct.category) {
            const additionalProducts = await Product.find({
                category: currentProduct.category,
                _id: { $nin: [productId, ...recommendedIds] },
                approvalStatus: 'approved',
                region: regionId // <<< LỌC THEO KHU VỰC
            }).limit(limit - recommendations.length).lean();
            recommendations = [...recommendations, ...additionalProducts];
        }

        const finalRecommendations = recommendations
            .filter((p, index, self) => index === self.findIndex((t) => t._id.toString() === p._id.toString()))
            .filter(p => p.totalStock > 0 || p.requiresConsultation === true);
            
        res.json(finalRecommendations);
    } catch (error) {
        console.error('❌ Lỗi khi lấy sản phẩm gợi ý:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
};
