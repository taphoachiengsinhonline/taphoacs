// File: backend/controllers/reviewController.js

const Review = require('../models/Review');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const mongoose = require('mongoose');
const moment = require('moment-timezone'); 
const Notification = require('../models/Notification');

const updateSellerRatingFromProduct = async (productId) => {
    try {
        const product = await Product.findById(productId).select('seller');
        if (!product || !product.seller) return;

        const sellerId = product.seller;

        const stats = await Review.aggregate([
            { $match: { reviewFor: 'product' } },
            {
                $lookup: {
                    from: 'products',
                    localField: 'targetId',
                    foreignField: '_id',
                    as: 'product'
                }
            },
            { $unwind: '$product' },
            { $match: { 'product.seller': new mongoose.Types.ObjectId(sellerId) } },
            { $group: {
                _id: '$product.seller',
                ratingQuantity: { $sum: 1 },
                ratingAverage: { $avg: '$rating' }
            }}
        ]);

        if (stats.length > 0) {
            const { ratingQuantity, ratingAverage } = stats[0];
            await User.findByIdAndUpdate(sellerId, {
                'shopProfile.rating': ratingAverage,
                'shopProfile.ratingQuantity': ratingQuantity
            });
            console.log(`Updated ratings for seller ${sellerId}: ${ratingAverage.toFixed(1)} stars, ${ratingQuantity} reviews.`);
        } else {
            await User.findByIdAndUpdate(sellerId, {
                'shopProfile.rating': null,
                'shopProfile.ratingQuantity': 0
            });
            console.log(`No reviews found for seller ${sellerId}, reset rating.`);
        }
    } catch (error) {
        console.error(`Error updating seller rating from product ${productId}:`, error);
    }
};

// Hàm tính toán và cập nhật rating trung bình cho Product hoặc Shipper
const updateRatings = async (reviewFor, targetId) => {
    try {
        const stats = await Review.aggregate([
            { $match: { reviewFor, targetId: new mongoose.Types.ObjectId(targetId) } },
            { $group: {
                _id: '$targetId',
                ratingQuantity: { $sum: 1 },
                ratingAverage: { $avg: '$rating' }
            }}
        ]);

        if (stats.length > 0) {
            const { ratingQuantity, ratingAverage } = stats[0];
            if (reviewFor === 'product') {
                await Product.findByIdAndUpdate(targetId, {
                    ratingQuantity: ratingQuantity,
                    ratingAverage: ratingAverage
                });
                console.log(`Updated ratings for product ${targetId}: ${ratingAverage.toFixed(1)} stars, ${ratingQuantity} reviews.`);

                // 🟢 THÊM DÒNG NÀY: Cập nhật rating cho seller của sản phẩm
                await updateSellerRatingFromProduct(targetId);

            } else if (reviewFor === 'shipper') {
                await User.findByIdAndUpdate(targetId, {
                    'shipperProfile.ratingQuantity': ratingQuantity,
                    'shipperProfile.rating': ratingAverage
                });
                console.log(`Updated ratings for shipper ${targetId}: ${ratingAverage.toFixed(1)} stars, ${ratingQuantity} reviews.`);
            }
        } else {
            // Không còn review nào
            if (reviewFor === 'product') {
                await Product.findByIdAndUpdate(targetId, {
                    ratingQuantity: 0,
                    ratingAverage: null
                });
                console.log(`No reviews left for product ${targetId}, reset rating.`);

                // 🟢 THÊM DÒNG NÀY: Cập nhật lại seller rating khi sản phẩm hết review
                await updateSellerRatingFromProduct(targetId);

            } else if (reviewFor === 'shipper') {
                await User.findByIdAndUpdate(targetId, {
                    'shipperProfile.ratingQuantity': 0,
                    'shipperProfile.rating': null
                });
                console.log(`No reviews left for shipper ${targetId}, reset rating.`);
            }
        }
    } catch (error) {
        console.error(`Error updating ratings for ${reviewFor} ${targetId}:`, error);
    }
};

exports.createReview = async (req, res) => {
    try {
        const { orderId, reviews } = req.body;
        const userId = req.user._id;

        const order = await Order.findById(orderId);
        const combinationMap = {};
            order.items.forEach(item => {
            if (item.productId) {
                combinationMap[item.productId.toString()] = item.combination || null;
                                }
                             });
        
        if (!order) {
            return res.status(404).json({ message: "Không tìm thấy đơn hàng này." });
        }
        if (order.user.toString() !== userId.toString()) {
            return res.status(403).json({ message: "Bạn không có quyền đánh giá đơn hàng này." });
        }
        if (order.status !== 'Đã giao') {
            return res.status(400).json({ message: `Chỉ có thể đánh giá đơn hàng đã được giao thành công.` });
        }
        if (order.isReviewed === true) {
            return res.status(400).json({ message: "Bạn đã đánh giá đơn hàng này rồi." });
        }
        if (!order.timestamps || !order.timestamps.deliveredAt) {
            return res.status(400).json({ message: "Đơn hàng chưa có dữ liệu thời gian giao hàng hợp lệ." });
        }

        const deliveredAt = moment(order.timestamps.deliveredAt);
        const now = moment();
        const daysSinceDelivery = now.diff(deliveredAt, 'days');
        if (daysSinceDelivery > 7) {
            return res.status(400).json({ message: "Đã quá 7 ngày kể từ khi nhận hàng, bạn không thể đánh giá đơn hàng này nữa." });
        }

        const existingReviews = await Review.find({ orderId, user: userId }).select('targetId');
        const reviewedTargetIds = existingReviews.map(r => r.targetId.toString());

        const newReviewData = reviews.filter(review => {
            if (!review.targetId || !review.rating) return false;
            if (reviewedTargetIds.includes(review.targetId)) {
                console.warn(`User ${userId} attempted to re-review target ${review.targetId} in order ${orderId}. Skipping.`);
                return false;
            }
            return true;
        });

        if (newReviewData.length === 0) {
            return res.status(400).json({ message: "Tất cả các mục bạn gửi đã được đánh giá trước đó hoặc dữ liệu không hợp lệ." });
        }


        const reviewDocsToCreate = newReviewData.map(review => ({
            orderId,
            user: userId,
            reviewFor: review.type,
            targetId: review.targetId,
            rating: review.rating,
            comment: review.comment,
            variantCombination: review.type === 'product' ? combinationMap[review.targetId] || null : null 
        }));

        // 🟢 Lưu và lấy lại danh sách review đã tạo (có _id)
        const createdReviews = await Review.insertMany(reviewDocsToCreate);

        // Cập nhật rating cho product/shipper
        const targetsToUpdate = newReviewData.map(r => ({ type: r.type, id: r.targetId }));
        const uniqueTargets = Array.from(new Map(targetsToUpdate.map(item => [`${item.type}-${item.id}`, item])).values());
        const updatePromises = uniqueTargets.map(target => updateRatings(target.type, target.id));
        await Promise.all(updatePromises);

        // 🟢 Gửi thông báo cho seller (nếu có đánh giá sản phẩm)
        for (const review of createdReviews) {
            if (review.reviewFor === 'product') {
                const product = await Product.findById(review.targetId).populate('seller', 'fcmToken _id name');
                if (product && product.seller) {
                    const seller = product.seller;
                    const notificationTitle = '🔔 Đánh giá mới';
                    const notificationBody = `Sản phẩm "${product.name}" vừa nhận được đánh giá ${review.rating} sao.`;

                    // Lưu thông báo vào DB
                    await Notification.create({
                        user: seller._id,
                        title: notificationTitle,
                        message: notificationBody,
                        type: 'product_review',
                        data: {
                            screen: 'ProductDetailForSeller',
                            productId: product._id.toString(),
                            reviewId: review._id.toString()
                        }
                    });

                    // Gửi push notification
                    if (seller.fcmToken) {
                        await safeNotify(seller.fcmToken, {
                            title: notificationTitle,
                            body: notificationBody,
                            data: {
                                screen: 'ProductDetailForSeller',
                                productId: product._id.toString(),
                                reviewId: review._id.toString()
                            }
                        });
                        await safeNotifyV2(seller._id, {
                            title: notificationTitle,
                            body: notificationBody,
                            data: {
                                screen: 'ProductDetailForSeller',
                                productId: product._id.toString(),
                                reviewId: review._id.toString()
                            }
                        });
                    }
                }
            }
        }

        // ✅ Trả về response sau khi hoàn tất mọi thứ
        res.status(201).json({ message: "Cảm ơn bạn đã đánh giá!" });

    } catch (error) {
        console.error("Lỗi khi tạo đánh giá:", error);
        if (error.code === 11000) {
            return res.status(400).json({ message: "Một trong các mục bạn đánh giá đã được gửi đi trước đó." });
        }
        res.status(500).json({ message: "Đã xảy ra lỗi khi gửi đánh giá." });
    }
};

const canUserViewOrderReviews = async (user, orderId) => {
    const order = await Order.findById(orderId)
        .populate('shipper', 'region')
        .populate('items.sellerId', 'region managedBy');
    if (!order) return false;

    // Admin toàn quyền
    if (user.role === 'admin') return true;

    // Region manager chỉ xem được đơn hàng thuộc khu vực mình quản lý
    if (user.role === 'region_manager' && user.region) {
        const orderRegion = order.region?.toString();
        if (orderRegion === user.region.toString()) return true;
    }

    // Shipper chỉ xem đơn hàng của mình (nếu cần, nhưng màn hình này không dành cho shipper)
    if (user.role === 'shipper' && order.shipper?._id.equals(user._id)) return true;

    // Seller chỉ xem đơn hàng chứa sản phẩm của mình
    if (user.role === 'seller') {
        const isSellerInOrder = order.items.some(item => 
            item.sellerId?._id.equals(user._id)
        );
        if (isSellerInOrder) return true;
    }

    // Customer chỉ xem đơn hàng của chính họ (nếu cần)
    if (order.user?.equals(user._id)) return true;

    return false;
};



// 🟢 THÊM HÀM MỚI: Lấy danh sách đánh giá cho shipper (hỗ trợ filter rating & phân trang)
exports.getReviewsForShipper = async (req, res) => {
    try {
        const { shipperId } = req.params;
        const { page = 1, limit = 5, rating } = req.query;

        const query = {
            reviewFor: 'shipper',
            targetId: shipperId,
            comment: { $exists: true, $ne: '' }
        };
        if (rating) {
            query.rating = parseInt(rating);
        }

        const options = {
            page: parseInt(page),
            limit: parseInt(limit),
            sort: { createdAt: -1 },
            populate: { path: 'user', select: 'name avatar' },
            lean: true
        };

        const reviews = await Review.paginate(query, options);
        res.status(200).json(reviews);
    } catch (error) {
        console.error("Lỗi khi lấy danh sách đánh giá shipper:", error);
        res.status(500).json({ message: "Lỗi server." });
    }
};

// Lấy tất cả đánh giá cho một sản phẩm (công khai)
exports.getReviewsForProduct = async (req, res) => {
    try {
        const { productId } = req.params;
        const { page = 1, limit = 5, rating } = req.query;

        const query = {
            reviewFor: 'product',
            targetId: productId,
            comment: { $exists: true, $ne: '' }
        };
        if (rating) {
            query.rating = parseInt(rating);
        }

        const options = {
            page: parseInt(page),
            limit: parseInt(limit),
            sort: { createdAt: -1 },
            populate: { path: 'user', select: 'name avatar' },
            lean: true
        };

        const reviews = await Review.paginate(query, options);
        res.status(200).json(reviews);
    } catch (error) {
        console.error("Lỗi khi lấy danh sách đánh giá:", error);
        res.status(500).json({ message: "Lỗi server." });
    }
};
// Lấy trạng thái đánh giá cho một đơn hàng (cần xác thực)
exports.getReviewStatusForOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user._id;

        const reviews = await Review.find({ orderId, user: userId }).select('targetId');
        
        const reviewedTargetIds = reviews.map(r => r.targetId.toString());

        res.status(200).json({ reviewedTargetIds });
    } catch (error) {
        console.error("Lỗi khi lấy trạng thái đánh giá:", error);
        res.status(500).json({ message: "Lỗi server." });
    }
};


// 🟢 THÊM HÀM MỚI: Lấy thống kê số lượng đánh giá theo từng mức sao
exports.getRatingStats = async (req, res) => {
    try {
        const { targetType, targetId } = req.params;

        // Xác định loại đối tượng hợp lệ (thêm 'seller')
        if (!['shipper', 'product', 'seller'].includes(targetType)) {
            return res.status(400).json({ message: 'Loại đối tượng không hợp lệ. Chỉ chấp nhận shipper, product, hoặc seller.' });
        }

        let matchCondition = {};
        let groupIdField = '$_id';

        if (targetType === 'seller') {
            // Với seller, cần join qua products để lấy tất cả đánh giá sản phẩm của seller đó
            const stats = await Review.aggregate([
                { $match: { reviewFor: 'product' } },
                {
                    $lookup: {
                        from: 'products',
                        localField: 'targetId',
                        foreignField: '_id',
                        as: 'product'
                    }
                },
                { $unwind: '$product' },
                { $match: { 'product.seller': new mongoose.Types.ObjectId(targetId) } },
                {
                    $group: {
                        _id: '$rating',
                        count: { $sum: 1 }
                    }
                }
            ]);

            // Khởi tạo object đếm 1-5 sao
            const ratingCounts = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
            let totalReviews = 0;
            let totalSum = 0;

            stats.forEach(item => {
                const star = item._id;
                if (star >= 1 && star <= 5) {
                    ratingCounts[star] = item.count;
                    totalReviews += item.count;
                    totalSum += star * item.count;
                }
            });

            const average = totalReviews > 0 ? totalSum / totalReviews : null;

            // Lấy thông tin rating đã lưu trong shopProfile để đảm bảo đồng bộ
            const seller = await User.findById(targetId).select('shopProfile.rating shopProfile.ratingQuantity');
            return res.json({
                targetId,
                targetType,
                ratingCounts,
                totalReviews: seller?.shopProfile?.ratingQuantity || totalReviews,
                average: seller?.shopProfile?.rating || average
            });
        } else {
            // Xử lý cho product và shipper như cũ
            const stats = await Review.aggregate([
                {
                    $match: {
                        reviewFor: targetType,
                        targetId: new mongoose.Types.ObjectId(targetId)
                    }
                },
                {
                    $group: {
                        _id: '$rating',
                        count: { $sum: 1 }
                    }
                }
            ]);

            const ratingCounts = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
            let totalReviews = 0;
            let totalSum = 0;

            stats.forEach(item => {
                const star = item._id;
                if (star >= 1 && star <= 5) {
                    ratingCounts[star] = item.count;
                    totalReviews += item.count;
                    totalSum += star * item.count;
                }
            });

            const average = totalReviews > 0 ? totalSum / totalReviews : null;

            res.json({
                targetId,
                targetType,
                ratingCounts,
                totalReviews,
                average
            });
        }
    } catch (error) {
        console.error('Lỗi khi lấy thống kê đánh giá:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};


exports.getReviewsForSeller = async (req, res) => {
    try {
        const { sellerId } = req.params;
        const { page = 1, limit = 10, rating } = req.query;

        // Tìm tất cả sản phẩm của seller
        const products = await Product.find({ seller: sellerId }).select('_id').lean();
        const productIds = products.map(p => p._id);

        const query = {
            reviewFor: 'product',
            targetId: { $in: productIds },
            comment: { $exists: true, $ne: '' }
        };
        if (rating) query.rating = parseInt(rating);

        const options = {
            page: parseInt(page),
            limit: parseInt(limit),
            sort: { createdAt: -1 },
            populate: { path: 'user', select: 'name avatar' },
            lean: true
        };

        const reviews = await Review.paginate(query, options);
        res.status(200).json(reviews);
    } catch (error) {
        console.error('Lỗi lấy đánh giá seller:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};



// Lấy tất cả reviews của một đơn hàng
exports.getOrderReviews = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user._id;
        const user = await User.findById(userId);

        if (!await canUserViewOrderReviews(user, orderId)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem đánh giá của đơn hàng này.' });
        }

        const reviews = await Review.find({ orderId })
            .populate('user', 'name email')
            .lean();

        // Phân loại reviews theo loại
        const shipperReview = reviews.find(r => r.reviewFor === 'shipper');
        const productReviews = reviews.filter(r => r.reviewFor === 'product');

        // Lấy thêm thông tin sản phẩm nếu cần (populate thủ công)
        const populatedProductReviews = await Promise.all(
            productReviews.map(async (rev) => {
                const product = await Product.findById(rev.targetId).select('name images').lean();
                return { ...rev, product };
            })
        );

        res.json({
            shipperReview: shipperReview || null,
            productReviews: populatedProductReviews
        });
    } catch (error) {
        console.error('Lỗi lấy đánh giá đơn hàng:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.replyToReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { reply } = req.body;
        const sellerId = req.user._id;

        const review = await Review.findById(reviewId).populate('targetId');
        if (!review) return res.status(404).json({ message: 'Không tìm thấy đánh giá' });

        // Kiểm tra quyền: reviewFor phải là 'product' và seller phải là chủ sản phẩm
        if (review.reviewFor !== 'product') {
            return res.status(400).json({ message: 'Chỉ có thể phản hồi đánh giá sản phẩm' });
        }

        const product = await Product.findById(review.targetId);
        if (!product || !product.seller.equals(sellerId)) {
            return res.status(403).json({ message: 'Bạn không phải chủ sản phẩm này' });
        }

        review.sellerReply = reply;
        review.repliedAt = new Date();
        await review.save();

        res.json({ message: 'Phản hồi thành công', review });
    } catch (error) {
        console.error('Lỗi phản hồi đánh giá:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
