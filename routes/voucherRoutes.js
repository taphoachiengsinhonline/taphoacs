const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const { verifyToken, restrictTo } = require('../middlewares/authMiddleware');

router.use(verifyToken);
router.get('/my', (req, res, next) => {
  console.log('Hit GET /vouchers/my');
  next();
}, voucherController.getMyVouchers);

router.post('/collect/:id', (req, res, next) => {
  console.log('Hit POST /vouchers/collect/:id');
  next();
}, voucherController.collectVoucher);

router.get('/', restrictTo('admin'), (req, res, next) => {
  console.log('Hit GET /vouchers');
  next();
}, voucherController.getAllVouchers);

router.post('/', restrictTo('admin'), (req, res, next) => {
  console.log('Hit POST /vouchers');
  next();
}, voucherController.createVoucher);

router.get('/:id', restrictTo('admin'), (req, res, next) => {
  console.log('Hit GET /vouchers/:id');
  next();
}, voucherController.getVoucherById);

router.patch('/:id', restrictTo('admin'), (req, res, next) => {
  console.log('Hit PATCH /vouchers/:id');
  next();
}, voucherController.updateVoucher);

router.delete('/:id', restrictTo('admin'), (req, res, next) => {
  console.log('Hit DELETE /vouchers/:id');
  next();
}, voucherController.deleteVoucher);

router.post('/apply', (req, res, next) => {
  console.log('Hit POST /vouchers/apply');
  next();
}, voucherController.applyVoucher);

router.post('/bulk', restrictTo('admin'), (req, res, next) => {
  console.log('Hit POST /vouchers/bulk');
  next();
}, voucherController.createBulkVouchers);

module.exports = router;
