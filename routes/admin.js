// File: backend/routes/admin.js (PHIÊN BẢN TÁI CẤU TRÚC CUỐI CÙNG)

const express = require('express');
const router = express.Router();

// Middleware
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const { verifyRegionManager } = require('../middlewares/regionAuthMiddleware');

// Controllers
const adminController = require('../controllers/adminController');
const orderController = require('../controllers/orderController');

// Middleware chung: Tất cả các route trong file này đều yêu cầu phải đăng nhập
router.use(verifyToken);

// =========================================================
// ===      ROUTES DÙNG CHUNG CHO ADMIN & QUẢN LÝ VÙNG    ===
// =========================================================
// Các API này được bảo vệ bởi `verifyRegionManager`, cho phép cả 2 vai trò truy cập.
// Logic lọc dữ liệu theo vùng sẽ được xử lý bên trong controller.

// --- Quản lý Đơn hàng ---
router.get('/orders', verifyRegionManager, orderController.getAllOrders); 
router.get('/orders/admin-count-by-status', verifyRegionManager, orderController.adminCountByStatus);

// --- Quản lý Seller ---
router.get('/sellers', verifyRegionManager, adminController.getAllSellers);

// --- Quản lý Shipper ---
router.get('/shippers', verifyRegionManager, adminController.getAllShippers);
router.post('/shippers', verifyRegionManager, adminController.createShipper);
router.put('/shippers/:id', verifyRegionManager, adminController.updateShipper);

// --- Phê duyệt Seller ---
router.get('/sellers/pending', verifyRegionManager, adminController.getPendingSellers);
router.post('/sellers/:sellerId/approve', verifyRegionManager, adminController.approveSeller);
router.post('/sellers/:sellerId/reject', verifyRegionManager, adminController.rejectSeller);

// --- Phê duyệt Sản phẩm ---
router.get('/products/pending', verifyRegionManager, adminController.getPendingProducts);
router.post('/products/:productId/approve', verifyRegionManager, adminController.approveProduct);
router.post('/products/:productId/reject', verifyRegionManager, adminController.rejectProduct);

// --- Dashboard & Tổng quan Tài chính ---
router.get('/financial-overview', verifyRegionManager, adminController.getFinancialOverview);
router.get('/dashboard-counts', verifyRegionManager, adminController.getAdminDashboardCounts);
router.get('/all-pending-counts', verifyRegionManager, adminController.getAllPendingCounts); // Dùng chung được

// ===============================================
// ===      ROUTES CHỈ DÀNH CHO ADMIN          ===
// ===============================================
// Áp dụng middleware `isAdmin` cho tất cả các route từ đây trở xuống.
router.use(isAdmin);

// --- Quản lý Hệ thống ---
router.get('/region-managers', adminController.getRegionManagers);
router.post('/region-managers', adminController.createRegionManager);
router.put('/region-managers/:managerId', adminController.updateRegionManager);
router.put('/users/:userId/assign-manager', adminController.assignManagerToUser);

// --- Tác vụ Cấp cao ---
router.patch('/sellers/:sellerId/commission', adminController.updateSellerCommission);
router.post('/shippers/:id/test-notification', adminController.sendTestNotificationToShipper);
router.post('/shippers/:id/fake-order', adminController.sendFakeOrderToShipper);
router.get('/products/pending/count', adminController.countPendingProducts);

// --- Tài chính & Đối soát Toàn hệ thống ---
router.get('/shipper-debt-overview', adminController.getShipperDebtOverview);
router.get('/remittances/pending-count', adminController.countPendingRemittanceRequests);
router.patch('/remittance-request/:requestId/process', adminController.processRemittanceRequest);
router.get('/shipper-financial-overview', adminController.getShipperFinancialOverview);
router.get('/shippers/:shipperId/financial-details', adminController.getShipperFinancialDetails);
router.get('/shippers/:shipperId/comprehensive-financials', adminController.getShipperComprehensiveFinancials);
router.post('/shippers/:shipperId/pay-salary', adminController.payShipperSalary);
router.get('/seller-financial-overview', adminController.getSellerFinancialOverview);
router.get('/sellers/:sellerId/comprehensive-financials', adminController.getSellerComprehensiveFinancials);
router.post('/sellers/:sellerId/pay', adminController.payToSeller);
router.post('/shippers/:shipperId/remind-debt', adminController.remindShipperToPayDebt);

module.exports = router;
