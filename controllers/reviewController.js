// File: backend/controllers/reviewController.js

const Review = require('../models/Review');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const mongoose = require('mongoose');
const moment = require('moment-timezone'); 

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
        
        // ĐÃ SỬA: Đảm bảo order có thời gian giao hàng hợp lệ trước khi tính toán
        if (!order.timestamps || !order.timestamps.deliveredAt) {
            return res.status(400).json({ message: "Đơn hàng chưa có dữ liệu thời gian giao hàng hợp lệ." });
        }

        const deliveredAt = moment(order.timestamps.deliveredAt);
        const now = moment();
        const daysSinceDelivery = now.diff(deliveredAt, 'days');

        if (daysSinceDelivery > 7) {
            return res.status(400).json({ message: "Đã quá 7 ngày kể từ khi nhận hàng, bạn không thể đánh giá đơn hàng này nữa." });
        }

        // Kiểm tra xem có đánh giá nào bị trùng lặp không
        const existingReviews = await Review.find({ orderId, user: userId }).select('targetId');
        const reviewedTargetIds = existingReviews.map(r => r.targetId.toString());

        const newReviewData = reviews.filter(review => {
            if (!review.targetId || !review.rating) return false; // Lọc bỏ dữ liệu không hợp lệ
            if (reviewedTargetIds.includes(review.targetId)) {
                console.warn(`User ${userId} attempted to re-review target ${review.targetId} in order ${orderId}. Skipping.`);
                return false; // Bỏ qua nếu đã đánh giá rồi
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
            comment: review.comment
        }));

        await Review.insertMany(reviewDocsToCreate);

        // Cập nhật lại rating cho các sản phẩm và shipper liên quan
        const targetsToUpdate = newReviewData.map(r => ({ type: r.type, id: r.targetId }));
        const uniqueTargets = Array.from(new Map(targetsToUpdate.map(item => [`${item.type}-${item.id}`, item])).values());
        
        const updatePromises = uniqueTargets.map(target => updateRatings(target.type, target.id));
        await Promise.all(updatePromises);

        res.status(201).json({ message: "Cảm ơn bạn đã đánh giá!" });
    } catch (error) {
        console.error("Lỗi khi tạo đánh giá:", error);
        // Xử lý lỗi trùng lặp từ MongoDB index
        if (error.code === 11000) {
            return res.status(400).json({ message: "Một trong các mục bạn đánh giá đã được gửi đi trước đó." });
        }
        res.status(500).json({ message: "Đã xảy ra lỗi khi gửi đánh giá." });
    }
};

// Lấy tất cả đánh giá cho một sản phẩm (công khai)
exports.getReviewsForProduct = async (req, res) => {
    try {
        const { productId } = req.params;
        const { page = 1, limit = 5 } = req.query;

        // Định nghĩa các tùy chọn cho phân trang
        const options = {
            page: parseInt(page),
            limit: parseInt(limit),
            sort: { createdAt: -1 }, // Mới nhất lên đầu
            // Cú pháp populate đúng cho mongoose-paginate-v2
            populate: {
                path: 'user', // Tên trường cần populate
                select: 'name avatar' // Các trường cần lấy từ collection 'users'
            },
            lean: true // Tăng hiệu năng bằng cách trả về plain JS objects
        };
        
        // Query để lọc các đánh giá
        const query = {
            reviewFor: 'product',
            targetId: productId,
            comment: { $exists: true, $ne: '' }
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

        // Xác định loại đối tượng hợp lệ
        if (!['shipper', 'product'].includes(targetType)) {
            return res.status(400).json({ message: 'Loại đối tượng không hợp lệ. Chỉ chấp nhận shipper hoặc product.' });
        }

        // Aggregate đếm số review theo rating (1-5)
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

        res.json({
            targetId,
            targetType,
            ratingCounts,
            totalReviews,
            average
        });
    } catch (error) {
        console.error('Lỗi khi lấy thống kê đánh giá:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

