// routes/payoutRoutes.js
const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const PayoutRequest = require('../models/PayoutRequest');
const LedgerEntry = require('../models/LedgerEntry');

// Admin lấy tất cả các yêu cầu rút tiền
router.get('/', verifyToken, isAdmin, async (req, res) => {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const requests = await PayoutRequest.find(filter).populate('seller', 'name email').sort('-createdAt');
    res.json(requests);
});


router.get('/pending/count', verifyToken, isAdmin, async (req, res) => {
    try {
        const count = await PayoutRequest.countDocuments({ status: 'pending' });
        res.json({ count });
    } catch (error) {
        console.error("Lỗi đếm yêu cầu rút tiền:", error);
        res.status(500).json({ message: "Lỗi server" });
    }
});


// Admin cập nhật trạng thái một yêu cầu
router.patch('/:id/status', verifyToken, isAdmin, async (req, res) => {
    const { status, rejectionReason } = req.body;
    if (!status) return res.status(400).json({ message: 'Thiếu trạng thái mới' });

    const request = await PayoutRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Không tìm thấy yêu cầu' });

    request.status = status;
    request.processedAt = new Date();
    if (status === 'rejected' && rejectionReason) {
        request.rejectionReason = rejectionReason;
    }
    
    // Nếu admin xác nhận hoàn tất, tạo bút toán Ghi nợ (debit)
    if (status === 'completed' && request.amount > 0) {
            request.completedAt = new Date();
            
            // Kiểm tra để tránh tạo bút toán debit trùng lặp
            const existingDebit = await LedgerEntry.findOne({ 
                payoutRequest: request._id, // Dùng một trường để liên kết
                type: 'debit'
            });

            if (!existingDebit) {
                const lastEntry = await LedgerEntry.findOne({ seller: request.seller }).sort({ createdAt: -1 });
                const currentBalance = lastEntry ? lastEntry.balanceAfter : 0;
                const newBalance = currentBalance - request.amount;

                await LedgerEntry.create({
                    seller: request.seller,
                    type: 'debit',
                    amount: request.amount,
                    description: `Admin đã thanh toán yêu cầu #${request._id.toString().slice(-6)}`,
                    balanceAfter: newBalance,
                    payoutRequest: request._id // Thêm liên kết này
                });
                console.log(`[FINANCE] Đã tạo bút toán DEBIT cho Seller ${request.seller} với số tiền ${request.amount}`);
            }
            // ...
        }

    await request.save();
    res.json({ message: 'Cập nhật trạng thái thành công', request });
});

module.exports = router;
