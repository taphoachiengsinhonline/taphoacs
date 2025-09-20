// File: backend/routes/regionManagerRoutes.js

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const regionManagerController = require('../controllers/regionManagerController'); // Chúng ta sẽ tạo file này ở bước 2

// Middleware để đảm bảo chỉ Quản lý Vùng mới có thể truy cập các route này
const verifyIsRegionManager = (req, res, next) => {
    if (req.user && (req.user.role === 'region_manager' || req.user.role === 'admin')) {
        // Cho phép cả admin truy cập để dễ debug
        next();
    } else {
        return res.status(403).json({ message: 'Truy cập bị từ chối. Yêu cầu quyền Quản lý Vùng.' });
    }
};

// Áp dụng middleware cho tất cả các route trong file này
router.use(verifyToken);
router.use(verifyIsRegionManager);

// === ĐỊNH NGHĨA ROUTE BÁO CÁO TÀI CHÍNH TẠI ĐÂY ===
// GET /api/v1/region-manager/financial-overview
router.get('/financial-overview', regionManagerController.getFinancialOverview);

// Trong tương lai, bạn có thể thêm các route khác vào đây
// router.get('/sellers', regionManagerController.getManagedSellers);
// router.get('/shippers', regionManagerController.getManagedShippers);

module.exports = router;
