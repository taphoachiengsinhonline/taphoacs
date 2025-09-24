// File: backend/routes/regionRoutes.js

const express = require('express');
const router = express.Router();
const regionController = require('../controllers/regionController');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const { verifyRegionManager } = require('../middlewares/regionAuthMiddleware');

// === XÓA DÒNG NÀY ĐI ===
// router.use(verifyToken, isAdmin);

// === SỬA LẠI CÁC ROUTE NHƯ SAU ===

// Ai có thể xem danh sách khu vực? => Admin và Quản lý Vùng
router.get('/', [verifyToken, verifyRegionManager], regionController.getAllRegions);

// Ai có thể tạo, sửa, xóa khu vực? => Chỉ Admin
router.post('/', [verifyToken, isAdmin], regionController.createRegion);
router.put('/:regionId', [verifyToken, isAdmin], regionController.updateRegion);
router.delete('/:regionId', [verifyToken, isAdmin], regionController.deleteRegion);

module.exports = router;
