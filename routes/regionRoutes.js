// File: backend/routes/regionRoutes.js

const express = require('express');
const router = express.Router();
const regionController = require('../controllers/regionController');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const { verifyRegionManager } = require('../middlewares/regionAuthMiddleware');

// =====================================================================
// 🟢 PUBLIC ROUTES (KHÔNG YÊU CẦU TOKEN - Khách vãng lai dùng được)
// =====================================================================

// 1. Xem danh sách TẤT CẢ khu vực (Dùng cho Modal chọn vùng của Khách)
router.get('/', regionController.getAllRegions);

// 2. Tìm khu vực dựa trên GPS (Dùng cho App tự động quét vùng gần nhất)
router.post('/available-at-location', regionController.getAvailableRegionsAtLocation);


// =====================================================================
// 🔴 PROTECTED ROUTES (BẢO MẬT - YÊU CẦU TOKEN VÀ QUYỀN ADMIN)
// =====================================================================

// Ai có thể tạo, sửa, xóa khu vực? => Chỉ Admin
router.post('/', [verifyToken, isAdmin], regionController.createRegion);
router.put('/:regionId', [verifyToken, isAdmin], regionController.updateRegion);
router.delete('/:regionId', [verifyToken, isAdmin], regionController.deleteRegion);

module.exports = router;
