// controllers/sellerController.js

const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const PendingUpdate = require('../models/PendingUpdate'); // <<< THÊM IMPORT NÀY
const { sendOtpSms } = require('../utils/sms');          // <<< THÊM IMPORT NÀY
const crypto = require('crypto'); 

// API cho Dashboard
exports.getDashboardStats = async (req, res) => {
    try {
        const sellerId = req.user._id;

        // Đếm sản phẩm theo trạng thái
        const productStatsPromise = Product.aggregate([
            { $match: { seller: sellerId } },
            { $group: { _id: '$approvalStatus', count: { $sum: 1 } } }
        ]);

        // Lấy tất cả các ID sản phẩm của seller
        const sellerProducts = await Product.find({ seller: sellerId }).select('_id');
        const productIds = sellerProducts.map(p => p._id);

        // Đếm đơn hàng đang chờ xử lý của seller
        const ordersToProcessPromise = Order.countDocuments({
            'items.sellerId': sellerId,
            status: { $in: ['Chờ xác nhận', 'Đang xử lý'] }
        });
        
        // Lấy dữ liệu doanh thu
        const revenueDataPromise = Order.aggregate([
            { $unwind: '$items' },
            { $match: { 'items.sellerId': sellerId, status: 'Đã giao' } },
            { $group: {
                _id: null,
                totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
            }}
        ]);

        const [productCounts, ordersToProcess, revenueData] = await Promise.all([
            productStatsPromise,
            ordersToProcessPromise,
            revenueDataPromise,
        ]);
        
        const stats = productCounts.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
        }, { approved: 0, pending_approval: 0, rejected: 0 });

        res.json({
            productStats: stats,
            ordersToProcess: ordersToProcess,
            totalRevenue: revenueData[0]?.totalRevenue || 0,
            // Thêm các thống kê khác nếu cần
        });

    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi lấy thống kê dashboard' });
    }
};

// API lấy sản phẩm của Seller
exports.getSellerProducts = async (req, res) => {
    try {
        const products = await Product.find({ seller: req.user._id }).sort({ createdAt: -1 });
        res.json(products);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// API lấy đơn hàng của Seller
exports.getSellerOrders = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const orders = await Order.find({ 'items.sellerId': sellerId })
            .populate('user', 'name')
            .sort({ 'timestamps.createdAt': -1 });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// API cập nhật FCM Token
exports.updateFcmToken = async (req, res) => {
    try {
        const { fcmToken } = req.body;
        if (!fcmToken) return res.status(400).json({ message: "Thiếu fcmToken" });
        await User.findByIdAndUpdate(req.user._id, { fcmToken });
        res.status(200).json({ message: "Cập nhật FCM token cho seller thành công" });
    } catch (error) {
        res.status(500).json({ message: "Lỗi server" });
    }
};

exports.requestUpdatePaymentInfo = async (req, res) => {
    try {
        const { bankName, accountHolderName, accountNumber } = req.body;
        if (!bankName || !accountHolderName || !accountNumber) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin thanh toán.' });
        }

        // Tạo mã OTP ngẫu nhiên gồm 6 chữ số
        const otp = crypto.randomInt(100000, 999999).toString();
        
        // Xóa các yêu cầu cũ của user này để đảm bảo chỉ có 1 OTP hợp lệ tại 1 thời điểm
        await PendingUpdate.deleteMany({ userId: req.user._id, type: 'paymentInfo' });
        
        // Lưu yêu cầu tạm thời vào DB, OTP sẽ tự hết hạn sau 5 phút (theo schema)
        await PendingUpdate.create({
            userId: req.user._id,
            type: 'paymentInfo',
            otp,
            payload: { bankName, accountHolderName, accountNumber }
        });

        // Gửi SMS chứa OTP đến số điện thoại đã đăng ký của user
        await sendOtpSms(req.user.phone, otp);

        console.log(`[PAYMENT_UPDATE] Đã tạo yêu cầu cập nhật và gửi OTP ${otp} cho user ${req.user._id}`);
        res.status(200).json({ message: 'Mã xác thực đã được gửi đến số điện thoại của bạn.' });

    } catch (error) {
        console.error("Lỗi khi yêu cầu cập nhật thông tin thanh toán:", error);
        res.status(500).json({ message: 'Lỗi server khi yêu cầu cập nhật.' });
    }
};

// Bước 2: Seller gửi OTP lên để xác thực
exports.verifyUpdatePaymentInfo = async (req, res) => {
    try {
        const { otp } = req.body;
        if (!otp || otp.length !== 6) {
            return res.status(400).json({ message: 'Vui lòng nhập mã OTP gồm 6 chữ số.' });
        }

        // Tìm yêu cầu đang chờ xử lý, hợp lệ và chưa hết hạn
        const pendingRequest = await PendingUpdate.findOne({
            userId: req.user._id,
            otp,
            type: 'paymentInfo',
            expiresAt: { $gt: new Date() } // Đảm bảo OTP chưa hết hạn
        });

        if (!pendingRequest) {
            return res.status(400).json({ message: 'Mã OTP không hợp lệ hoặc đã hết hạn.' });
        }

        // Nếu OTP đúng, tiến hành cập nhật thông tin
        const { bankName, accountHolderName, accountNumber } = pendingRequest.payload;
        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            { 
                $set: {
                    'paymentInfo.bankName': bankName,
                    'paymentInfo.accountHolderName': accountHolderName,
                    'paymentInfo.accountNumber': accountNumber,
                }
            },
            { new: true, runValidators: true }
        ).select('-password'); // Bỏ password khỏi kết quả trả về
        
        // Xóa yêu cầu tạm sau khi đã dùng xong
        await PendingUpdate.findByIdAndDelete(pendingRequest._id);

        console.log(`[PAYMENT_UPDATE] User ${req.user._id} đã xác thực OTP và cập nhật thông tin thành công.`);
        res.status(200).json({ message: 'Cập nhật thông tin thanh toán thành công!', user: updatedUser });

    } catch (error) {
        console.error("Lỗi khi xác thực OTP:", error);
        res.status(500).json({ message: 'Lỗi server khi xác thực OTP.' });
    }
};
