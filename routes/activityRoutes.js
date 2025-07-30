// routes/activityRoutes.js
const express = require('express');
const router = express.Router();
const UserActivity = require('../models/UserActivity');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/', verifyToken, async (req, res) => {
    try {
        const { activityType, productId, categoryId, searchQuery } = req.body;
        
        // Không cần chờ đợi (fire-and-forget) để không làm chậm app client
        UserActivity.create({
            userId: req.user._id,
            activityType,
            productId,
            categoryId,
            searchQuery
        }).catch(err => console.error("Lỗi ghi nhận hành vi:", err));

        // Trả về thành công ngay lập tức
        res.status(202).send();

    } catch (error) {
        // Trường hợp này hiếm khi xảy ra
        res.status(400).json({ message: error.message });
    }
});

module.exports = router;
