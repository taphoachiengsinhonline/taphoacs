// File: backend/routes/regionRoutes.js
const express = require('express');
const router = express.Router();
const regionController = require('../controllers/regionController');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const { verifyRegionManager } = require('../middlewares/regionAuthMiddleware');

// Áp dụng middleware cho tất cả các route trong file này
router.use(verifyToken, isAdmin);

// Định nghĩa các route CRUD
router.get('/', [verifyToken, verifyRegionManager], regionController.getAllRegions);
router.post('/', regionController.createRegion);
router.put('/:regionId', regionController.updateRegion);
router.delete('/:regionId', regionController.deleteRegion);

module.exports = router;
