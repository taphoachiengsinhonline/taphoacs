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


exports.getAllProducts = async (req, res) => {
    try {
        const { category, limit, sellerId } = req.query;
        let filter = { approvalStatus: 'approved' };

        if (sellerId) {
            filter.seller = sellerId;
        } else if (req.user && req.user.region) {
            filter.region = req.user.region;
        }

        if (category && category !== 'Tất cả') {
            const ids = [category, ...(await getAllChildCategoryIds(category))];
            filter.category = { $in: ids };
        }

        // --- BẮT ĐẦU SỬA LOGIC QUAN TRỌNG ---
        // Sử dụng .populate() để lấy thông tin seller, bao gồm cả shopProfile
        let query = Product.find(filter)
            .populate('category')
            .populate({
                path: 'seller',
                select: 'name shopProfile' // Lấy tên và shopProfile (chứa isPaused)
            })
            .sort({ createdAt: -1 });

        if (limit) {
            query = query.limit(parseInt(limit));
        }
        
        let products = await query.exec();
        
        // Logic lọc sản phẩm hết hàng vẫn giữ nguyên
        // Lưu ý: KHÔNG lọc sản phẩm của shop đang tạm ngưng ở đây nữa
        if (!sellerId) {
            products = products.filter(p => p.totalStock > 0 || p.requiresConsultation === true);
        }
        
        res.json(products);
        // --- KẾT THÚC SỬA LOGIC ---

    } catch (err) {
        console.error('❌ Lỗi khi lấy sản phẩm:', err);
        res.status(500).json({ error: err.message });
    }
};

// --- HÀM 2: LẤY SẢN PHẨM BÁN CHẠY NHẤT ---
exports.getBestSellers = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 10;
        let matchStage = { status: 'Đã giao' };

        if (req.user && req.user.region) {
            matchStage.region = new mongoose.Types.ObjectId(req.user.region);
        }

        const bestSellers = await Order.aggregate([
            { $match: matchStage },
            { $unwind: '$items' },
            { $group: { _id: '$items.productId', totalQuantitySold: { $sum: '$items.quantity' } } },
            { $sort: { totalQuantitySold: -1 } },
            { $limit: limit },
            { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'productDetails' } },
            { $unwind: '$productDetails' },
            { $match: { 'productDetails.approvalStatus': 'approved' } },
            { $replaceRoot: { newRoot: '$productDetails' } }
        ]);
        res.json(bestSellers);
    } catch (err) {
        console.error('❌ Lỗi khi lấy sản phẩm bán chạy:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
};


exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
        .populate('category')
        .populate('seller', 'name shopProfile.avatar shopProfile.lastActive');

    if (!product) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });
    }

    // --- BẮT ĐẦU SỬA ---
    // Log để kiểm tra dữ liệu thô từ DB
    console.log("--- DEBUG: Dữ liệu sản phẩm từ DB (getProductById) ---");
    console.log("Rating Quantity:", product.ratingQuantity);
    console.log("Rating Average:", product.ratingAverage);
    console.log("----------------------------------------------------");
    // --- KẾT THÚC SỬA ---

    res.json(product);
  } catch (err) {
    console.error('❌ Lỗi khi lấy chi tiết sản phẩm:', err);
    res.status(500).json({ message: 'Lỗi server' });
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
            if (!seller) return;

            // 1. Tìm tất cả Admin
            const admins = await User.find({ role: 'admin' });
            
            // 2. Tìm Quản lý Vùng của khu vực này (nếu có)
            const regionManager = await User.findOne({ 
                role: 'region_manager', 
                region: savedProduct.region 
            });

            // 3. Gộp tất cả người nhận thông báo lại
            let recipients = [...admins];
            if (regionManager) {
                // Tránh trường hợp admin cũng là QLV và bị trùng
                if (!recipients.find(r => r._id.equals(regionManager._id))) {
                    recipients.push(regionManager);
                }
            }

            if (recipients.length > 0) {
                const title = "Sản phẩm mới chờ duyệt";
                const body = `${seller.name} vừa đăng SP mới: "${savedProduct.name}".`;
                
                const notificationPromises = recipients.map(recipient => {
                    // a. Lưu thông báo vào DB
                    const dbNotification = Notification.create({
                        user: recipient._id, title, message: body, type: 'product',
                        data: { productId: savedProduct._id.toString(), screen: 'ProductApproval' }
                    });

                    // b. Gửi push notification nếu có token
                    let pushNotification = Promise.resolve();
                    if (recipient.fcmToken) {
                        pushNotification = safeNotify(recipient.fcmToken, {
                            title, body,
                            data: { productId: savedProduct._id.toString(), screen: 'ProductApproval' }
                        });
                    }
                    return Promise.all([dbNotification, pushNotification]);
                });
                
                await Promise.all(notificationPromises);
                console.log(`[Product] Đã gửi thông báo duyệt sản phẩm đến ${recipients.length} người (Admin/QLV).`);
            }
        } catch (notificationError) {
            console.error("[Product] Lỗi khi gửi thông báo cho admin/QLV:", notificationError);
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
        (async () => {
          try {
              // Logic gửi thông báo tương tự như hàm createProduct
              const seller = await User.findById(req.user._id).select('name');
              const admins = await User.find({ role: 'admin' });
              const regionManager = await User.findOne({ role: 'region_manager', region: product.region });
              
              let recipients = [...admins];
              if (regionManager && !recipients.find(r => r._id.equals(regionManager._id))) {
                  recipients.push(regionManager);
              }

              if (recipients.length > 0) {
                  const title = "Sản phẩm cần duyệt lại";
                  const body = `${seller.name} đã sửa đổi SP "${product.name}" và cần duyệt lại.`;
                  
                  const promises = recipients.map(r => Promise.all([
                      Notification.create({
                          user: r._id, title, message: body, type: 'product',
                          data: { productId: product._id.toString(), screen: 'ProductApproval' }
                      }),
                      r.fcmToken ? safeNotify(r.fcmToken, { title, body, data: { productId: product._id.toString(), screen: 'ProductApproval' } }) : Promise.resolve()
                  ]));
                  
                  await Promise.all(promises);
                  console.log(`[Product Update] Đã gửi thông báo duyệt lại sản phẩm đến ${recipients.length} người.`);
              }
          } catch (e) { console.error("[Product Update] Lỗi gửi thông báo duyệt lại:", e); }
        })();
        // --- KẾT THÚC THÊM LOGIC ---
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
        if (!currentProduct) { 
            return res.status(404).json({ message: "Sản phẩm không tồn tại." }); 
        }

        // --- Logic cho "Thường mua cùng" ---
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
                    if (id !== productId) { 
                        companionProductIds[id] = (companionProductIds[id] || 0) + 1; 
                    }
                });
            }
        });

        const sortedIds = Object.entries(companionProductIds)
            .sort(([, a], [, b]) => b - a)
            .map(([id]) => new mongoose.Types.ObjectId(id));
        
        let recommendations = [];
        if (sortedIds.length > 0) {
            recommendations = await Product.find({ 
                _id: { $in: sortedIds }, 
                approvalStatus: 'approved',
                region: regionId 
            }).lean();
        }

        // --- Logic cho "Sản phẩm liên quan" để lấp đầy ---
        if (recommendations.length < limit && currentProduct.category) {
            const existingIds = [productId, ...recommendations.map(p => p._id.toString())];
            const additionalProducts = await Product.find({
                category: currentProduct.category,
                _id: { $nin: existingIds.map(id => new mongoose.Types.ObjectId(id)) },
                approvalStatus: 'approved',
                region: regionId 
            }).limit(limit - recommendations.length).lean();
            recommendations.push(...additionalProducts);
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
