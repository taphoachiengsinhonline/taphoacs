// File: backend/controllers/reviewController.js
const Review = require('../models/Review');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');

// Hàm tính toán và cập nhật rating cho Product hoặc Shipper
const updateRatings = async (reviewFor, targetId) => {
    const stats = await Review.aggregate([
        { $match: { reviewFor, targetId: new mongoose.Types.ObjectId(targetId) } },
        { $group: {
            _id: '$targetId',
            ratingQuantity: { $sum: 1 },
            ratingAverage: { $avg: '$rating' }
        }}
    ]);

    if (stats.length > 0) {
        if (reviewFor === 'product') {
            await Product.findByIdAndUpdate(targetId, {
                ratingQuantity: stats[0].ratingQuantity,
                ratingAverage: stats[0].ratingAverage
            });
        } else if (reviewFor === 'shipper') {
            await User.findByIdAndUpdate(targetId, {
                'shipperProfile.ratingQuantity': stats[0].ratingQuantity,
                'shipperProfile.rating': stats[0].ratingAverage
            });
        }
    }
};

exports.createReview = async (req, res) => {
    try {
        const { orderId, reviews } = req.body; // reviews là một mảng [{ type, targetId, rating, comment }]
        const userId = req.user._id;

        const order = await Order.findById(orderId);
        if (!order || order.user.toString() !== userId.toString()) {
            return res.status(403).json({ message: "Bạn không có quyền đánh giá đơn hàng này." });
        }

        const reviewPromises = reviews.map(review => {
            return Review.create({
                orderId,
                user: userId,
                reviewFor: review.type, // 'product' or 'shipper'
                targetId: review.targetId,
                rating: review.rating,
                comment: review.comment
            });
        });

        await Promise.all(reviewPromises);

        // Cập nhật lại rating cho các sản phẩm và shipper liên quan
        const updatePromises = reviews.map(review => updateRatings(review.type, review.targetId));
        await Promise.all(updatePromises);
        
        // (Tùy chọn) Cập nhật trạng thái đơn hàng để biết đã được đánh giá
        order.isReviewed = true;
        await order.save();

        res.status(201).json({ message: "Cảm ơn bạn đã đánh giá!" });
    } catch (error) {
        console.error("Lỗi khi tạo đánh giá:", error);
        res.status(500).json({ message: "Đã xảy ra lỗi." });
    }
};
