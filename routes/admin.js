// File: backend/routes/admin.js (PHIÊN BẢN HOÀN CHỈNH, CHỈ ĐỊNH NGHĨA ROUTES)

const express = require('express');
const router = express.Router();

// Middleware
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const { verifyRegionManager } = require('../middlewares/regionAuthMiddleware');

// Controllers
const adminController = require('../controllers/adminController');
const orderController = require('../controllers/orderController');

// Middleware chung: Tất cả routes yêu cầu đăng nhập
router.use(verifyToken);

// ===============================================
// ===      QUẢN LÝ ĐƠN HÀNG (Admin & QLV)     ===
// ===============================================
router.get('/orders', verifyRegionManager, orderController.getAllOrders);
router.get('/orders/admin-count-by-status', verifyRegionManager, orderController.adminCountByStatus);

// ===============================================
// ===      QUẢN LÝ SHIPPER (Admin & QLV)      ===
// ===============================================
router.get('/shippers', verifyRegionManager, adminController.getAllShippers);
router.post('/shippers', verifyRegionManager, adminController.createShipper);
router.put('/shippers/:id', verifyRegionManager, adminController.updateShipper);
router.post('/shippers/:id/test-notification', isAdmin, adminController.sendTestNotificationToShipper);
router.post('/shippers/:id/fake-order', isAdmin, adminController.sendFakeOrderToShipper);

// ===============================================
// ===      QUẢN LÝ SELLER (Admin & QLV)       ===
// ===============================================
router.get('/sellers', verifyRegionManager, adminController.getAllSellers);
router.get('/sellers/pending', verifyRegionManager, adminController.getPendingSellers);
router.post('/sellers/:sellerId/approve', verifyRegionManager, adminController.approveSeller);
router.post('/sellers/:sellerId/reject', verifyRegionManager, adminController.rejectSeller);
router.patch('/sellers/:sellerId/commission', isAdmin, adminController.updateSellerCommission);

// ===============================================
// ===      QUẢN LÝ SẢN PHẨM (Admin & QLV)     ===
// ===============================================
router.get('/products/pending/count', verifyRegionManager, adminController.countPendingProducts);
router.get('/products/pending', verifyRegionManager, adminController.getPendingProducts);
router.post('/products/:productId/approve', verifyRegionManager, adminController.approveProduct);
router.post('/products/:productId/reject', verifyRegionManager, adminController.rejectProduct);

// ===============================================
// ===      DASHBOARD & TÀI CHÍNH (Admin & QLV) ===
// ===============================================
router.get('/financial-overview', verifyRegionManager, adminController.getFinancialOverview);
router.get('/dashboard-counts', verifyRegionManager, adminController.getAdminDashboardCounts);
router.get('/all-pending-counts', verifyRegionManager, adminController.getAllPendingCounts);
router.get('/shipper-financial-overview', verifyRegionManager, adminController.getShipperFinancialOverview);
router.get('/seller-financial-overview', verifyRegionManager, adminController.getSellerFinancialOverview);

// ===============================================
// ===      ROUTES CHỈ DÀNH CHO ADMIN          ===
// ===============================================
router.get('/region-managers', isAdmin, adminController.getRegionManagers);
router.post('/region-managers', isAdmin, adminController.createRegionManager);
router.put('/region-managers/:managerId', isAdmin, adminController.updateRegionManager);
router.put('/users/:userId/assign-manager', isAdmin, adminController.assignManagerToUser);
router.get('/shipper-debt-overview', isAdmin, adminController.getShipperDebtOverview);
router.get('/remittances/pending-count', isAdmin, adminController.countPendingRemittanceRequests);
router.patch('/remittance-request/:requestId/process', isAdmin, adminController.processRemittanceRequest);
router.get('/shippers/:shipperId/financial-details', isAdmin, adminController.getShipperFinancialDetails);
router.get('/shippers/:shipperId/comprehensive-financials', isAdmin, adminController.getShipperComprehensiveFinancials);
router.post('/shippers/:shipperId/pay-salary', isAdmin, adminController.payShipperSalary);
router.get('/sellers/:sellerId/comprehensive-financials', isAdmin, adminController.getSellerComprehensiveFinancials);
router.post('/sellers/:sellerId/pay', isAdmin, adminController.payToSeller);
router.post('/shippers/:shipperId/remind-debt', isAdmin, adminController.remindShipperToPayDebt);

module.exports = router;
