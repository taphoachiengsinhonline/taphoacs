const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const bcrypt = require('bcrypt');
const sendPushNotification = require('../utils/sendPushNotification');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Remittance = require('../models/Remittance');
const RemittanceRequest = require('../models/RemittanceRequest');
const moment = require('moment-timezone');
const mongoose = require('mongoose');

// Middleware: Yêu cầu tất cả các route trong file này phải là admin đã đăng nhập
router.use(verifyToken, isAdmin);

// ===============================================
// ===      QUẢN LÝ SHIPPER (Giữ nguyên)       ===
// ===============================================

// Tạo tài khoản shipper mới
router.post('/shippers', async (req, res) => {
    try {
        const { email, password, name, phone, address, shipperProfile } = req.body;
        const { vehicleType, licensePlate } = shipperProfile || {};
        if (!email || !password || !name || !phone || !address || !vehicleType || !licensePlate) {
            return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đầy đủ thông tin' });
        }
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ status: 'error', message: 'Email đã tồn tại' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const shipper = new User({
            email, password: hashedPassword, name, address, phone, role: 'shipper',
            shipperProfile: { vehicleType, licensePlate }
        });
        await shipper.save();
        res.status(201).json({ status: 'success', data: { _id: shipper._id, email: shipper.email, role: shipper.role, shipperProfile: shipper.shipperProfile } });
    } catch (error) {
        console.error('Error creating shipper:', error);
        res.status(500).json({ status: 'error', message: 'Lỗi server: ' + error.message });
    }
});

// Lấy danh sách shipper
router.get('/shippers', async (req, res) => {
    try {
        const shippers = await User.find({ role: 'shipper' }).select('name email address phone location locationUpdatedAt isAvailable shipperProfile').lean({ virtuals: true });
        const nowVN = Date.now() + (7 * 60 * 60 * 1000);
        const processedShippers = shippers.map(shipper => {
            const updatedAt = shipper.locationUpdatedAt?.getTime() || 0;
            const diff = nowVN - updatedAt;
            const isOnline = diff > 0 && diff <= 300000;
            return { ...shipper, isOnline, lastUpdateSeconds: Math.floor(diff / 1000) };
        });
        const onlineCount = processedShippers.filter(s => s.isOnline).length;
        res.json({ status: 'success', onlineCount, shippers: processedShippers });
    } catch (error) {
        console.error('Lỗi lấy danh sách shipper:', error);
        res.status(500).json({ status: 'error', message: 'Lỗi server: ' + error.message });
    }
});

// Cập nhật thông tin shipper
router.put('/shippers/:id', async (req, res) => {
    try {
        const shipperId = req.params.id;
        const { name, email, phone, address, shipperProfile } = req.body;
        if (!shipperProfile) {
            return res.status(400).json({ message: 'Thiếu thông tin shipperProfile.' });
        }
        const updateData = {
            name, email, phone, address,
            $set: {
                'shipperProfile.vehicleType': shipperProfile.vehicleType,
                'shipperProfile.licensePlate': shipperProfile.licensePlate,
                'shipperProfile.shippingFeeShareRate': shipperProfile.shippingFeeShareRate,
                'shipperProfile.profitShareRate': shipperProfile.profitShareRate,
            }
        };
        const updated = await User.findByIdAndUpdate(shipperId, updateData, { new: true, runValidators: true });
        if (!updated) return res.status(404).json({ message: 'Không tìm thấy shipper' });
        res.json({ status: 'success', data: updated });
    } catch (error) {
        console.error('Lỗi cập nhật shipper:', error);
        res.status(500).json({ message: 'Lỗi server: ' + error.message });
    }
});

// Gửi thông báo kiểm tra đến shipper
router.post('/shippers/:id/test-notification', async (req, res) => {
  try {
    const shipperId = req.params.id;
    const shipper = await User.findById(shipperId);
    if (!shipper) {
      return res.status(404).json({ status: 'error', message: 'Shipper không tồn tại' });
    }
    if (!shipper.fcmToken) {
      return res.status(400).json({ status: 'error', message: 'Shipper chưa có FCM token' });
    }
    await sendPushNotification(shipper.fcmToken, 'Kiểm tra thông báo', 'Admin đang kiểm tra hệ thống thông báo');
    res.json({ status: 'success', message: 'Đã gửi thông báo kiểm tra' });
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({ status: 'error', message: 'Lỗi server: ' + error.message });
  }
});

// Gửi đơn hàng ảo đến shipper
router.post('/shippers/:id/fake-order', async (req, res) => {
  try {
    const shipperId = req.params.id;
    const shipper = await User.findById(shipperId);
    if (!shipper) {
      return res.status(404).json({ status: 'error', message: 'Shipper không tồn tại' });
    }
    if (!shipper.fcmToken) {
      return res.status(400).json({ status: 'error', message: 'Shipper chưa có FCM token' });
    }
    const fakeOrderId = 'FAKE-' + Math.floor(Math.random() * 10000);
    const fakeAddress = '123 Đường kiểm tra, Quận 1, TP.HCM';
    const fakeAmount = Math.floor(Math.random() * 500000) + 50000;
    await sendPushNotification(shipper.fcmToken, `Đơn hàng mới #${fakeOrderId}`, `Giao đến: ${fakeAddress} - ${fakeAmount.toLocaleString('vi-VN')}đ`);
    res.json({ status: 'success', message: 'Đã gửi thông báo đơn hàng ảo', order: { id: fakeOrderId, address: fakeAddress, amount: fakeAmount } });
  } catch (error) {
    console.error('Error sending fake order:', error);
    res.status(500).json({ status: 'error', message: 'Lỗi server: ' + error.message });
  }
});

// ===============================================
// ===      QUẢN LÝ SELLER (Giữ nguyên)        ===
// ===============================================
router.get('/sellers', async (req, res) => {
    try {
        const sellers = await User.find({ role: 'seller' }).select('name email commissionRate');
        res.json(sellers);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});
router.patch('/sellers/:sellerId/commission', async (req, res) => {
    try {
        const { commissionRate } = req.body;
        if (commissionRate === undefined || commissionRate < 0 || commissionRate > 100) {
            return res.status(400).json({ message: 'Chiết khấu không hợp lệ' });
        }
        const seller = await User.findByIdAndUpdate(req.params.sellerId, { commissionRate }, { new: true });
        if (!seller) return res.status(404).json({ message: 'Không tìm thấy seller' });
        res.json({ message: 'Cập nhật thành công', seller });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// ===============================================
// ===      QUẢN LÝ SẢN PHẨM (Giữ nguyên)     ===
// ===============================================
router.get('/products/pending/count', async (req, res) => {
    try {
        const count = await Product.countDocuments({ approvalStatus: 'pending_approval' });
        res.json({ count });
    } catch (error) {
        console.error('Lỗi đếm sản phẩm chờ duyệt:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
});
router.get('/products/pending', async (req, res) => {
    try {
        const pendingProducts = await Product.find({ approvalStatus: 'pending_approval' }).populate('seller', 'name');
        res.json(pendingProducts);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});
router.post('/products/:productId/approve', async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(req.params.productId, { approvalStatus: 'approved' }, { new: true });
        if (!product) return res.status(404).json({ message: 'Sản phẩm không tồn tại' });
        res.json({ message: 'Đã phê duyệt sản phẩm', product });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});
router.post('/products/:productId/reject', async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ message: 'Cần có lý do từ chối' });
        const product = await Product.findByIdAndUpdate(req.params.productId, { approvalStatus: 'rejected', rejectionReason: reason }, { new: true });
        if (!product) return res.status(404).json({ message: 'Sản phẩm không tồn tại' });
        res.json({ message: 'Đã từ chối sản phẩm', product });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
});

// ===============================================
// ===   API MỚI: QUẢN LÝ CÔNG NỢ SHIPPER      ===
// ===============================================

// Lấy danh sách tổng quan công nợ của tất cả shipper
router.get('/shipper-debt-overview', async (req, res) => {
    try {
        const shippers = await User.find({ role: 'shipper' }).select('name phone').lean();
        if (shippers.length === 0) {
            return res.status(200).json([]);
        }
        
        const pendingRequests = await RemittanceRequest.find({ status: 'pending' }).populate('shipper', 'name').lean();
        const pendingRequestMap = new Map();
        pendingRequests.forEach(req => {
            const shipperId = req.shipper._id.toString();
            if (!pendingRequestMap.has(shipperId)) {
                pendingRequestMap.set(shipperId, []);
            }
            pendingRequestMap.get(shipperId).push(req);
        });

        const debtData = [];
        for (const shipper of shippers) {
            const shipperId = shipper._id;
            const [codResult, remittedResult] = await Promise.all([
                Order.aggregate([ { $match: { shipper: shipperId, status: 'Đã giao' } }, { $group: { _id: null, total: { $sum: '$total' } } } ]),
                Remittance.aggregate([ { $match: { shipper: shipperId, status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } } ])
            ]);
            const totalCOD = codResult[0]?.total || 0;
            const totalRemitted = remittedResult[0]?.total || 0;
            const totalDebt = totalCOD - totalRemitted;

            debtData.push({ ...shipper, totalDebt: totalDebt > 0 ? totalDebt : 0, pendingRequests: pendingRequestMap.get(shipperId.toString()) || [] });
        }
        
        debtData.sort((a, b) => {
            if (b.pendingRequests.length > a.pendingRequests.length) return 1;
            if (b.pendingRequests.length < a.pendingRequests.length) return -1;
            return b.totalDebt - a.totalDebt;
        });

        res.status(200).json(debtData);
    } catch (error) {
        console.error("[getShipperDebtOverview] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
});

// Đếm số lượng yêu cầu đang chờ duyệt để hiển thị badge
router.get('/remittances/pending-count', async (req, res) => {
    try {
        const count = await RemittanceRequest.countDocuments({ status: 'pending' });
        res.status(200).json({ count });
    } catch (error) { 
        console.error("[countPendingRemittanceRequests] Lỗi:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
});

// Admin xử lý một yêu cầu (approve hoặc reject)
// routes/adminRoutes.js (File 14)
// THAY THẾ HOÀN TOÀN hàm processRemittanceRequest

router.patch('/remittance-request/:requestId/process', async (req, res) => {
    const { requestId } = req.params;
    const { action, adminNotes } = req.body;
    const adminId = req.user._id;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        // Tìm yêu cầu và thông tin của shipper
        const request = await RemittanceRequest.findById(requestId).populate('shipper').session(session);
        if (!request || request.status !== 'pending') {
            throw new Error("Yêu cầu không hợp lệ hoặc đã được xử lý.");
        }

        if (action === 'approve') {
            // Nếu yêu cầu này là để trả NỢ CŨ
            if (request.isForOldDebt) {
                // <<< ÁP DỤNG LOGIC TRẢ NỢ CŨ CỦA BẠN VÀO ĐÂY >>>
                let amountToApply = request.amount;
                // ... (toàn bộ code tìm nợ theo ngày và trừ dần)
                const orders = await Order.find({ shipper: request.shipper._id, status: 'Đã giao' }).sort({ 'timestamps.deliveredAt': 1 }).session(session);
                const allRemittances = await Remittance.find({ shipper: request.shipper._id, status: 'completed' }).session(session);
                // ... tính debtByDay ...
                // ... vòng lặp for (const day of sortedDebtDays) ...
                for (const day of sortedDebtDays) {
                    // ...
                    const payment = Math.min(debtOfDay, amountToApply);
                    await Remittance.findOneAndUpdate(
                        { shipper: request.shipper._id, remittanceDate: moment.tz(day, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh').startOf('day').toDate() },
                        { 
                            $inc: { amount: payment }, 
                            $set: { status: 'completed' }, // Đảm bảo status là completed
                            $push: { transactions: { amount: payment, confirmedAt: new Date(), notes: `Admin duyệt trả nợ cũ (Req: ${requestId})` } }
                        },
                        { upsert: true, new: true, session: session }
                    );
                    amountToApply -= payment;
                }

            } else {
                // <<< LOGIC MỚI: Yêu cầu này là để trả NỢ HÔM NAY >>>
                const today = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
                await Remittance.findOneAndUpdate(
                    { shipper: request.shipper._id, remittanceDate: today },
                    {
                        $inc: { amount: request.amount },
                        $set: { status: 'completed' }, // DUYỆT -> set status completed
                        $push: { transactions: { amount: request.amount, confirmedAt: new Date(), notes: `Admin duyệt (Req: ${requestId})` } }
                    },
                    { upsert: true, new: true, session: session }
                );
            }
            request.status = 'approved';
        } else if (action === 'reject') {
            request.status = 'rejected';
        } else {
            throw new Error("Hành động không hợp lệ.");
        }

        request.adminNotes = adminNotes;
        request.processedAt = new Date();
        request.approvedBy = adminId;
        await request.save({ session });
        
        await session.commitTransaction();
        res.status(200).json({ message: `Đã ${action === 'approve' ? 'xác nhận' : 'từ chối'} yêu cầu thành công.` });
    } catch (error) {
        await session.abortTransaction();
        console.error("[processRemittanceRequest] Lỗi:", error);
        res.status(500).json({ message: error.message });
    } finally {
        session.endSession();
    }
});


module.exports = router;
