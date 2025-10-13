// File: backend/controllers/adminController.js (PHIÊN BẢN HOÀN CHỈNH, TÁCH RIÊNG LOGIC)

// Dependencies
const User = require('../models/User');
const Region = require('../models/Region');
const Remittance = require('../models/Remittance');
const Order = require('../models/Order');
const Payout = require('../models/PayoutRequest');
const LedgerEntry = require('../models/LedgerEntry');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const RemittanceRequest = require('../models/RemittanceRequest');
const SalaryPayment = require('../models/SalaryPayment');
const Product = require('../models/Product');
const Notification = require('../models/Notification');
const { safeNotify } = require('../utils/notificationMiddleware');

// ===============================================
// ===      QUẢN LÝ SHIPPER (Admin & QLV)      ===
// ===============================================

/**
 * [Admin & QLV] Tạo tài khoản shipper mới.
 * QLV chỉ có thể tạo shipper trong vùng của mình và shipper đó sẽ do QLV quản lý.
 */
exports.createShipper = async (req, res) => {
    try {
       // Lấy dữ liệu từ body
        const { email, password, name, phone, address, shipperProfile } = req.body;
        // Cố gắng lấy regionId từ body
        const regionIdFromBody = req.body.regionId;
        
        const { vehicleType, licensePlate, shippingFeeShareRate, profitShareRate } = shipperProfile || {};

        if (!email || !password || !name || !phone || !address || !vehicleType || !licensePlate) {
            return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp đầy đủ thông tin' });
        }
        
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ status: 'error', message: 'Email đã tồn tại' });
        }

        // --- BẮT ĐẦU SỬA LOGIC GÁN VÙNG VÀ QUẢN LÝ ---
        let regionToAssign = null;
        let managerToAssign = null;

        if (req.user.role === 'region_manager') {
            regionToAssign = req.user.region;
            managerToAssign = req.user._id;
        } else if (req.user.role === 'admin') {  // Sửa: Sử dụng role === 'admin' thay vì isAdmin để nhất quán và tránh bug flag
            // Dùng regionId từ body
            if (!regionIdFromBody) { 
                return res.status(400).json({ status: 'error', message: 'Admin cần chọn một khu vực để tạo Shipper.' });
            }
            regionToAssign = regionIdFromBody;
        }

        if (!regionToAssign) {
            return res.status(400).json({ status: 'error', message: 'Không thể xác định khu vực để tạo Shipper.' });
        }
        // --- KẾT THÚC SỬA LOGIC GÁN VÙNG VÀ QUẢN LÝ ---

        const shipper = new User({
            email, password, name, address, phone,
            role: 'shipper',
            approvalStatus: 'approved',
            shipperProfile: { vehicleType, licensePlate, shippingFeeShareRate, profitShareRate },
            region: regionToAssign,
            managedBy: managerToAssign
        });
        await shipper.save();
        res.status(201).json({ status: 'success', data: shipper });
    } catch (error) {
        console.error('[createShipper] Lỗi:', error);
        res.status(500).json({ status: 'error', message: `Lỗi server: ${error.message}` });
    }
};

/**
 * [Admin & QLV] Lấy danh sách shipper.
 * Admin thấy tất cả, QLV chỉ thấy shipper trong vùng.
 */
exports.getAllShippers = async (req, res) => {
    try {
      let query = { role: 'shipper' };

        // --- BẮT ĐẦU SỬA LỖI KIỂU DỮ LIỆU ---
        if (req.user.role === 'region_manager') {
            if (!req.user.region) {
                // Trường hợp QLV chưa được gán vùng, trả về mảng rỗng
                return res.json({ status: 'success', onlineCount: 0, shippers: [] });
            }
            // Ép kiểu các giá trị string từ token thành ObjectId để query chính xác
            query.$or = [
                { managedBy: new mongoose.Types.ObjectId(req.user._id) },
                { region: new mongoose.Types.ObjectId(req.user.region) }
            ];
        }
        // --- KẾT THÚC SỬA LỖI KIỂU DỮ LIỆU ---
        
        const shippers = await User.find(query)
            .populate('managedBy', 'name')
            .populate('region', 'name')
            .select('name email address phone location locationUpdatedAt isAvailable shipperProfile managedBy region approvalStatus')
            .lean({ virtuals: true });

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
        console.error('[getAllShippers] Lỗi:', error);
        res.status(500).json({ status: 'error', message: `Lỗi server: ${error.message}` });
    }
};


exports.updateShipperStatus = async (req, res) => {
    try {
        const { shipperId } = req.params;
        const { status } = req.body; // status sẽ là 'locked' hoặc 'approved'

        if (!['locked', 'approved'].includes(status)) {
            return res.status(400).json({ message: 'Trạng thái không hợp lệ.' });
        }

        const shipper = await User.findById(shipperId);
        if (!shipper || shipper.role !== 'shipper') {
            return res.status(404).json({ message: 'Không tìm thấy shipper.' });
        }

        // Kiểm tra quyền cho QLV
        if (req.user.role === 'region_manager' && shipper.region?.toString() !== req.user.region.toString()) {
            return res.status(403).json({ message: 'Bạn không có quyền thay đổi trạng thái của shipper này.' });
        }

        shipper.approvalStatus = status;
        await shipper.save();

        res.status(200).json({ message: `Đã ${status === 'locked' ? 'khóa' : 'mở khóa'} tài khoản thành công.`, shipper });

    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi cập nhật trạng thái shipper.' });
    }
};

/**
 * [Admin & QLV] Cập nhật thông tin shipper.
 * QLV chỉ được cập nhật shipper trong vùng của mình.
 */
exports.updateShipper = async (req, res) => {
    try {
        const shipperId = req.params.id;
        const { name, email, phone, address, shipperProfile } = req.body;

        if (!shipperProfile) {
            return res.status(400).json({ message: 'Thiếu thông tin shipperProfile.' });
        }

        const shipperToUpdate = await User.findById(shipperId);
        if (!shipperToUpdate) {
            return res.status(404).json({ message: 'Không tìm thấy shipper' });
        }

        if (req.user.role === 'region_manager' && shipperToUpdate.region?.toString() !== req.user.region.toString()) {
            return res.status(403).json({ message: 'Bạn không có quyền sửa shipper này.' });
        }

        const updateData = {
            name, email, phone, address,
            shipperProfile: {
                vehicleType: shipperProfile.vehicleType,
                licensePlate: shipperProfile.licensePlate,
                shippingFeeShareRate: shipperProfile.shippingFeeShareRate,
                profitShareRate: shipperProfile.profitShareRate,
            }
        };
        const updated = await User.findByIdAndUpdate(shipperId, updateData, { new: true, runValidators: true });

        res.json({ status: 'success', data: updated });
    } catch (error) {
        console.error('[updateShipper] Lỗi:', error);
        res.status(500).json({ message: `Lỗi server: ${error.message}` });
    }
};


exports.updateUserRegion = async (req, res) => {
    try {
        const { userId } = req.params;
        const { regionId } = req.body;

        if (!regionId) {
            return res.status(400).json({ message: 'Vui lòng chọn một khu vực.' });
        }

        const regionExists = await Region.findById(regionId);
        if (!regionExists) {
            return res.status(404).json({ message: 'Khu vực không tồn tại.' });
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId, 
            { $set: { region: regionId } }, 
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
        }
        res.status(200).json({ message: 'Cập nhật khu vực thành công!', user: updatedUser });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi cập nhật khu vực.' });
    }
};

/**
 * [Admin & QLV] Cập nhật trạng thái (Khóa/Mở khóa) cho Seller.
 * QLV chỉ có thể khóa seller trong vùng của mình.
 */
exports.updateSellerStatus = async (req, res) => {
    try {
        const { sellerId } = req.params;
        const { status } = req.body; // status sẽ là 'locked' hoặc 'approved'

        if (!['locked', 'approved'].includes(status)) {
            return res.status(400).json({ message: 'Trạng thái không hợp lệ.' });
        }

        const seller = await User.findById(sellerId);
        if (!seller || seller.role !== 'seller') {
            return res.status(404).json({ message: 'Không tìm thấy seller.' });
        }

        // Kiểm tra quyền cho QLV
        if (req.user.role === 'region_manager' && seller.region?.toString() !== req.user.region.toString()) {
            return res.status(403).json({ message: 'Bạn không có quyền thay đổi trạng thái của seller này.' });
        }

        seller.approvalStatus = status;
        await seller.save();

        res.status(200).json({ message: `Đã ${status === 'locked' ? 'khóa' : 'mở khóa'} tài khoản thành công.`, seller });

    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi cập nhật trạng thái seller.' });
    }
};




/**
 * [Admin & QLV] Gửi thông báo kiểm tra đến shipper.
 */
exports.sendTestNotificationToShipper = async (req, res) => {
    try {
       
        const shipper = await User.findById(req.params.id);
        if (!shipper || !shipper.fcmToken) {
            return res.status(400).json({ message: 'Shipper không tồn tại hoặc không có FcmToken.' });
        }
        await safeNotify(shipper.fcmToken, {
            title: 'Kiểm tra thông báo',
            body: 'Admin đang kiểm tra hệ thống thông báo của bạn.',
            data: { type: 'test_notification' }
        });
        res.json({ status: 'success', message: 'Đã gửi thông báo kiểm tra' });
    } catch (error) {
        console.error('[sendTestNotificationToShipper] Lỗi:', error);
        res.status(500).json({ status: 'error', message: `Lỗi server: ${error.message}` });
    }
};

/**
 * [Admin Only] Gửi đơn hàng ảo đến shipper.
 */
exports.sendFakeOrderToShipper = async (req, res) => {
    try {
        
        const shipper = await User.findById(req.params.id);
        if (!shipper || !shipper.fcmToken) {
            return res.status(400).json({ message: 'Shipper không tồn tại hoặc không có FcmToken.' });
        }
        const fakeOrderId = 'FAKE-' + Math.floor(Math.random() * 10000);
        await safeNotify(shipper.fcmToken, {
            title: `Đơn hàng mới #${fakeOrderId}`,
            body: `Bạn có đơn hàng ảo để kiểm tra hệ thống.`,
            data: {
                orderId: fakeOrderId,
                notificationType: 'newOrderModal',
                distance: (Math.random() * 5).toFixed(2),
                shipperView: "true"
            }
        });
        res.json({ status: 'success', message: 'Đã gửi thông báo đơn hàng ảo' });
    } catch (error) {
        console.error('[sendFakeOrderToShipper] Lỗi:', error);
        res.status(500).json({ status: 'error', message: `Lỗi server: ${error.message}` });
    }
};

// ===============================================
// ===      QUẢN LÝ SẢN PHẨM (Admin & QLV)     ===
// ===============================================

/**
 * [Admin & QLV] Đếm số sản phẩm chờ duyệt.
 * QLV chỉ đếm sản phẩm trong vùng.
 */
exports.countPendingProducts = async (req, res) => {
    try {
       
        let query = { approvalStatus: 'pending_approval' };
        if (req.user.role === 'region_manager' && req.user.region) {
            const sellersInRegion = await User.find({ role: 'seller', region: req.user.region }).select('_id');
            const sellerIds = sellersInRegion.map(s => s._id);
            query.seller = { $in: sellerIds };
        }
        const count = await Product.countDocuments(query);
        res.json({ count });
    } catch (error) {
        console.error('[countPendingProducts] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

/**
 * [Admin & QLV] Lấy danh sách sản phẩm chờ duyệt.
 * QLV chỉ thấy sản phẩm của seller trong vùng.
 */
exports.getPendingProducts = async (req, res) => {
    try {
        
        let query = { approvalStatus: 'pending_approval' };
        if (req.user.role === 'region_manager' && req.user.region) {
            const sellersInRegion = await User.find({ role: 'seller', region: req.user.region }).select('_id');
            const sellerIds = sellersInRegion.map(s => s._id);
            query.seller = { $in: sellerIds };
        }
        const pendingProducts = await Product.find(query).populate('seller', 'name');
        res.json(pendingProducts);
    } catch (error) {
        console.error('[getPendingProducts] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

/**
 * [Admin & QLV] Phê duyệt sản phẩm.
 * QLV chỉ duyệt sản phẩm của seller trong vùng.
 */
exports.approveProduct = async (req, res) => {
    try {
        
        const product = await Product.findById(req.params.productId).populate('seller', 'region');
        if (!product) {
            return res.status(404).json({ message: 'Sản phẩm không tồn tại' });
        }
        if (req.user.role === 'region_manager' && product.seller.region?.toString() !== req.user.region.toString()) {
            return res.status(403).json({ message: 'Bạn không có quyền duyệt sản phẩm này.' });
        }
        product.approvalStatus = 'approved';
        product.rejectionReason = undefined;
        await product.save();
        res.json({ message: 'Đã phê duyệt sản phẩm', product });
    } catch (error) {
        console.error('[approveProduct] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

/**
 * [Admin & QLV] Từ chối sản phẩm.
 * QLV chỉ từ chối sản phẩm của seller trong vùng.
 */
exports.rejectProduct = async (req, res) => {
    try {
        
        const { reason } = req.body;
        if (!reason) {
            return res.status(400).json({ message: 'Cần có lý do từ chối' });
        }
        const product = await Product.findById(req.params.productId).populate('seller', 'region');
        if (!product) {
            return res.status(404).json({ message: 'Sản phẩm không tồn tại' });
        }
        if (req.user.role === 'region_manager' && product.seller.region?.toString() !== req.user.region.toString()) {
            return res.status(403).json({ message: 'Bạn không có quyền từ chối sản phẩm này.' });
        }
        product.approvalStatus = 'rejected';
        product.rejectionReason = reason;
        await product.save();
        res.json({ message: 'Đã từ chối sản phẩm', product });
    } catch (error) {
        console.error('[rejectProduct] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ===============================================
// ===      QUẢN LÝ SELLER (Admin & QLV)       ===
// ===============================================

/**
 * [Admin & QLV] Lấy danh sách Sellers.
 * Admin thấy tất cả, QLV chỉ thấy seller trong vùng.
 */
exports.getAllSellers = async (req, res) => {
    try {
        
        // Lấy tất cả seller, không lọc trạng thái ở đây để QLV có thể thấy cả seller bị từ chối
        let query = { role: 'seller' }; 

        // --- BẮT ĐẦU SỬA LOGIC QUAN TRỌNG ---
        if (req.user.role === 'region_manager' && req.user.region) {
            // Ép kiểu ObjectId để đảm bảo truy vấn chính xác
            query.region = new mongoose.Types.ObjectId(req.user.region);
        }
        // --- KẾT THÚC SỬA LOGIC ---
       const sellers = await User.find(query)
            .populate('managedBy', 'name')
            .populate('region', 'name')
            // Lấy thêm approvalStatus và rejectionReason để hiển thị trên app
            .select('name email phone address commissionRate managedBy region approvalStatus shopProfile'); 
        res.status(200).json(sellers);
    } catch (error) {
        console.error('[getAllSellers] Lỗi:', error);
        res.status(500).json({ message: `Lỗi server: ${error.message}` });
    }
};

/**
 * [Admin & QLV] Lấy danh sách Seller đang chờ duyệt.
 * QLV chỉ thấy seller trong vùng.
 */
exports.getPendingSellers = async (req, res) => {
    try {
        
        let query = { role: 'seller', approvalStatus: 'pending' };
        if (req.user.role === 'region_manager' && req.user.region) {
            query.region = req.user.region;
        }
        const pendingSellers = await User.find(query).sort({ createdAt: -1 });
        res.status(200).json(pendingSellers);
    } catch (error) {
        console.error('[getPendingSellers] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách seller.' });
    }
};

/**
 * [Admin & QLV] Phê duyệt một tài khoản Seller.
 * QLV chỉ duyệt seller trong vùng.
 */
exports.approveSeller = async (req, res) => {
    try {
        
        const { sellerId } = req.params;
        const seller = await User.findById(sellerId);
        if (!seller || seller.role !== 'seller' || seller.approvalStatus !== 'pending') {
            return res.status(404).json({ message: 'Không tìm thấy Seller đang chờ duyệt.' });
        }
        if (req.user.role === 'region_manager' && seller.region?.toString() !== req.user.region.toString()) {
            return res.status(403).json({ message: 'Bạn không có quyền duyệt seller này.' });
        }
        seller.approvalStatus = 'approved';
        await seller.save();
        res.status(200).json({ message: 'Đã phê duyệt Seller thành công.', seller });
    } catch (error) {
        console.error('[approveSeller] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi phê duyệt seller.' });
    }
};

/**
 * [Admin & QLV] Từ chối một tài khoản Seller.
 * QLV chỉ từ chối seller trong vùng.
 */
exports.rejectSeller = async (req, res) => {
    try {
        
        const { sellerId } = req.params;
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ message: 'Vui lòng cung cấp lý do từ chối.' });
        const seller = await User.findById(sellerId);
        if (!seller || seller.role !== 'seller' || seller.approvalStatus !== 'pending') {
            return res.status(404).json({ message: 'Không tìm thấy Seller đang chờ duyệt.' });
        }
        if (req.user.role === 'region_manager' && seller.region?.toString() !== req.user.region.toString()) {
            return res.status(403).json({ message: 'Bạn không có quyền từ chối seller này.' });
        }
        seller.approvalStatus = 'rejected';
        seller.rejectionReason = reason;
        await seller.save();
        res.status(200).json({ message: 'Đã từ chối Seller.', seller });
    } catch (error) {
        console.error('[rejectSeller] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi từ chối seller.' });
    }
};

/**
 * [Admin Only] Cập nhật chiết khấu sàn cho Seller.
 */
exports.updateSellerCommission = async (req, res) => {
    try {
        
        const { commissionRate } = req.body;
        if (commissionRate === undefined || commissionRate < 0 || commissionRate > 100) {
            return res.status(400).json({ message: 'Chiết khấu không hợp lệ' });
        }
        const seller = await User.findById(req.params.sellerId);
        if (!seller) return res.status(404).json({ message: 'Không tìm thấy seller' });
        seller.commissionRate = commissionRate;
        await seller.save();
        res.json({ message: 'Cập nhật thành công', seller });
    } catch (error) {
        console.error('[updateSellerCommission] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ===============================================
// ===      QUẢN LÝ HỆ THỐNG (Admin Only)      ===
// ===============================================

/**
 * [Admin Only] Lấy danh sách tất cả Quản lý Vùng
 */
exports.getRegionManagers = async (req, res) => {
    try {
       
        const managers = await User.find({ role: 'region_manager' })
            .populate('region', 'name')
            .select('name email phone region regionManagerProfile');
        res.status(200).json(managers);
    } catch (error) {
        console.error('[getRegionManagers] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách Quản lý Vùng.' });
    }
};

/**
 * [Admin Only] Tạo một Quản lý Vùng mới
 */
exports.createRegionManager = async (req, res) => {
    try {
        
        const { name, email, password, phone, regionId, profitShareRate } = req.body;
        if (!name || !email || !password || !phone || !regionId || profitShareRate == null) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin.' });
        }
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ message: 'Email này đã được sử dụng.' });
        }
        const region = await Region.findById(regionId);
        if (!region) {
            return res.status(404).json({ message: 'Khu vực được chọn không tồn tại.' });
        }
        const newManager = new User({
            name,
            email: email.toLowerCase().trim(),
            password,
            phone,
            role: 'region_manager',
            approvalStatus: 'approved',
            address: region.name,
            region: regionId,
            regionManagerProfile: {
                profitShareRate: parseFloat(profitShareRate)
            }
        });
        await newManager.save();
        const managerResponse = newManager.toObject();
        delete managerResponse.password;
        res.status(201).json(managerResponse);
    } catch (error) {
        console.error('[createRegionManager] Lỗi:', error);
        res.status(500).json({ message: `Lỗi server: ${error.message}` });
    }
};

/**
 * [Admin Only] Cập nhật thông tin Quản lý Vùng
 */
exports.updateRegionManager = async (req, res) => {
    try {
        
        const { managerId } = req.params;
        const { name, phone, regionId, profitShareRate } = req.body;
        const updateData = {};
        if (name) updateData.name = name;
        if (phone) updateData.phone = phone;
        if (regionId) updateData.region = regionId;
        if (profitShareRate != null) {
            updateData['regionManagerProfile.profitShareRate'] = parseFloat(profitShareRate);
        }
        const updatedManager = await User.findByIdAndUpdate(managerId, updateData, { new: true });
        if (!updatedManager) {
            return res.status(404).json({ message: 'Không tìm thấy Quản lý Vùng.' });
        }
        res.status(200).json(updatedManager);
    } catch (error) {
        console.error('[updateRegionManager] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi cập nhật Quản lý Vùng.' });
    }
};

/**
 * [Admin Only] Gán/Gỡ gán một User (Seller/Shipper) cho một Quản lý Vùng
 */
exports.assignManagerToUser = async (req, res) => {
    try {
        
        const { userId } = req.params;
        const { managerId } = req.body;

        const userToUpdate = await User.findById(userId);
        if (!userToUpdate || !['seller', 'shipper'].includes(userToUpdate.role)) {
            return res.status(404).json({ message: 'Không tìm thấy Seller hoặc Shipper này.' });
        }

        let updateOperation;
        if (managerId) {
            const manager = await User.findById(managerId);
            if (!manager || manager.role !== 'region_manager') {
                return res.status(404).json({ message: 'Người quản lý được chọn không hợp lệ.' });
            }
            updateOperation = { $set: { managedBy: managerId, region: manager.region } };
        } else {
            updateOperation = { $unset: { managedBy: "" } };
        }

        const updatedUser = await User.findByIdAndUpdate(userId, updateOperation, { new: true });
        res.status(200).json({ message: 'Cập nhật người quản lý thành công!', user: updatedUser });
    } catch (error) {
        console.error('[assignManagerToUser] Lỗi:', error);
        res.status(500).json({ message: `Lỗi server: ${error.message}` });
    }
};

// ===============================================
// ===      TÀI CHÍNH & BÁO CÁO (Admin & QLV)  ===
// ===============================================

/**
 * [Admin & QLV] Lấy tổng quan tài chính.
 * Admin thấy toàn hệ thống, QLV chỉ thấy vùng của mình.
 */
exports.getRegionManagerFinancials = async (req, res) => {
    try {
        console.log('[DEBUG] getRegionManagerFinancials - Admin:', req.user._id);

        // Bước 1: Lấy tất cả các QLV và thông tin cần thiết của họ
        const regionManagers = await User.find({ role: 'region_manager' })
            .populate('region', 'name')
            .select('name email phone region regionManagerProfile')
            .lean();

        if (regionManagers.length === 0) {
            return res.status(200).json([]);
        }

        const managerIds = regionManagers.map(m => m._id);

        // Bước 2: Dùng Aggregation để tính toán trên collection 'orders'
        // Tính tổng doanh thu và tổng lợi nhuận được chia cho mỗi QLV
        const financialStats = await Order.aggregate([
            {
                // Chỉ lấy các đơn hàng đã giao và có người nhận lợi nhuận là một trong các QLV
                $match: {
                    status: 'Đã giao',
                    profitRecipient: { $in: managerIds }
                }
            },
            {
                // Gom nhóm theo người nhận lợi nhuận (profitRecipient)
                $group: {
                    _id: '$profitRecipient', // Gom nhóm theo ID của QLV
                    totalManagedOrders: { $sum: 1 }, // Đếm số đơn hàng
                    // Tính tổng doanh thu từ các đơn hàng này
                    totalRevenueFromOrders: { $sum: '$total' }, 
                    // Tính tổng lợi nhuận mà QLV thực nhận
                    totalProfitShare: { $sum: '$recipientProfit' } 
                }
            }
        ]);

        // Bước 3: Gộp dữ liệu tài chính vào danh sách QLV
        const statsMap = new Map(financialStats.map(stat => [stat._id.toString(), stat]));

        const results = regionManagers.map(manager => {
            const managerStats = statsMap.get(manager._id.toString());
            return {
                ...manager,
                totalManagedOrders: managerStats?.totalManagedOrders || 0,
                totalRevenueFromOrders: managerStats?.totalRevenueFromOrders || 0,
                totalProfitShare: managerStats?.totalProfitShare || 0,
            };
        });

        res.status(200).json(results);

    } catch (error) {
        console.error('[getRegionManagerFinancials] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy dữ liệu tài chính QLV.' });
    }
};


exports.getFinancialOverview = async (req, res) => {
    try {
        
        let matchQuery = { status: 'Đã giao' };
        if (req.user.role === 'region_manager' && req.user.region) {
            matchQuery.region = req.user.region;
        }

        const orderFinancials = await Order.aggregate([
            { $match: matchQuery },
            {
                $project: {
                    deliveredAt: '$timestamps.deliveredAt',
                    totalRevenue: '$total',
                    totalShipperIncome: '$shipperIncome',
                    shippingFeeActual: { $ifNull: ['$shippingFeeActual', 0] },
                    extraSurcharge: { $ifNull: ['$extraSurcharge', 0] },
                    voucherDiscount: { $ifNull: ['$voucherDiscount', 0] },
                    itemsTotal: {
                        $reduce: {
                            input: '$items',
                            initialValue: 0,
                            in: { $add: ['$$value', { $multiply: ['$$this.price', '$$this.quantity'] }] }
                        }
                    },
                    totalCommission: {
                        $reduce: {
                            input: '$items',
                            initialValue: 0,
                            in: { $add: ['$$value', '$$this.commissionAmount'] }
                        }
                    }
                }
            },
            {
                $project: {
                    deliveredAt: 1,
                    grossRevenue: { $add: ['$itemsTotal', '$shippingFeeActual', '$extraSurcharge'] },
                    grossProfit: {
                        $subtract: [
                            { $add: ['$itemsTotal', '$shippingFeeActual', '$extraSurcharge'] },
                            {
                                $add: [
                                    { $subtract: ['$itemsTotal', '$totalCommission'] },
                                    '$totalShipperIncome',
                                    '$voucherDiscount'
                                ]
                            }
                        ]
                    },
                    voucherCost: '$voucherDiscount'
                }
            }
        ]);

        const totalHardSalaryPaidResult = await SalaryPayment.aggregate([
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalHardSalaryPaid = totalHardSalaryPaidResult[0]?.total || 0;

        const totalCodResult = await Order.aggregate([
            { $match: { ...matchQuery, paymentMethod: 'COD' } },
            { $group: { _id: null, total: { $sum: '$total' } } }
        ]);
        const totalCodCollected = totalCodResult[0]?.total || 0;

        const shipperDebtResult = await Order.aggregate([
            { $match: { ...matchQuery, paymentMethod: 'COD' } },
            { $group: { _id: '$shipper', totalCodCollected: { $sum: '$total' } } },
            { $lookup: { from: 'remittances', localField: '_id', foreignField: 'shipper', as: 'remittances' } },
            { $project: { shipperId: '$_id', debt: { $subtract: ['$totalCodCollected', { $sum: '$remittances.amount' }] } } },
            { $group: { _id: null, totalDebtToCollect: { $sum: { $max: [0, '$debt'] } } } }
        ]);
        const totalCodDebt = shipperDebtResult[0]?.totalDebtToCollect || 0;

        const sellerLiabilityResult = await User.aggregate([
            { $match: { role: 'seller', approvalStatus: 'approved', ...(req.user.role === 'region_manager' ? { region: req.user.region } : {}) } },
            { $lookup: { from: 'ledgerentries', localField: '_id', foreignField: 'seller', pipeline: [{ $sort: { createdAt: -1 } }, { $limit: 1 }], as: 'lastLedgerEntry' } },
            { $unwind: { path: '$lastLedgerEntry', preserveNullAndEmptyArrays: true } },
            { $group: { _id: null, totalBalanceToPay: { $sum: '$lastLedgerEntry.balanceAfter' } } }
        ]);
        const totalSellerLiability = sellerLiabilityResult[0]?.totalBalanceToPay || 0;

        const today = moment().tz('Asia/Ho_Chi_Minh');
        const thisMonth = today.month();
        const thisYear = today.year();
        const todayStr = today.format('YYYY-MM-DD');

        let daily = { revenue: 0, profit: 0, voucherCost: 0 };
        let monthly = { revenue: 0, profit: 0, voucherCost: 0 };
        let yearly = { revenue: 0, profit: 0, voucherCost: 0 };
        let allTime = { revenue: 0, profit: 0, voucherCost: 0 };

        orderFinancials.forEach(order => {
            const date = moment(order.deliveredAt).tz('Asia/Ho_Chi_Minh');
            const orderRevenue = order.grossRevenue || 0;
            const orderProfit = order.grossProfit || 0;
            const orderVoucherCost = order.voucherCost || 0;

            allTime.revenue += orderRevenue;
            allTime.profit += orderProfit;
            allTime.voucherCost += orderVoucherCost;

            if (date.year() === thisYear) {
                yearly.revenue += orderRevenue;
                yearly.profit += orderProfit;
                yearly.voucherCost += orderVoucherCost;
            }
            if (date.year() === thisYear && date.month() === thisMonth) {
                monthly.revenue += orderRevenue;
                monthly.profit += orderProfit;
                monthly.voucherCost += orderVoucherCost;
            }
            if (date.format('YYYY-MM-DD') === todayStr) {
                daily.revenue += orderRevenue;
                daily.profit += orderProfit;
                daily.voucherCost += orderVoucherCost;
            }
        });

        allTime.netProfit = allTime.profit - totalHardSalaryPaid;

        res.status(200).json({
            summary: {
                totalCodCollected: totalCodCollected,
                totalCodDebtToCollect: totalCodDebt,
                totalSellerLiabilityToPay: totalSellerLiability,
                netProfitAllTime: allTime.netProfit,
                totalVoucherCost: allTime.voucherCost,
            },
            revenueAndProfit: {
                today: daily,
                thisMonth: monthly,
                thisYear: yearly,
                allTime: { revenue: allTime.revenue, profit: allTime.profit, voucherCost: allTime.voucherCost }
            }
        });
    } catch (error) {
        console.error('[getFinancialOverview] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy tổng quan tài chính.' });
    }
};

/**
 * [Admin & QLV] Lấy các số liệu dashboard.
 * Admin thấy toàn hệ thống, QLV chỉ thấy vùng của mình.
 */
exports.getAdminDashboardCounts = async (req, res) => {
    try {
        
        const sellerQuery = { role: 'seller', approvalStatus: 'pending' };
        const productQuery = { approvalStatus: 'pending_approval' };
        if (req.user.role === 'region_manager' && req.user.region) {
            sellerQuery.region = req.user.region;
            const sellersInRegion = await User.find({ role: 'seller', region: req.user.region }).select('_id');
            productQuery.seller = { $in: sellersInRegion.map(s => s._id) };
        }

        const [
            pendingSellers,
            pendingProducts,
            pendingPayouts,
            pendingRemittances
        ] = await Promise.all([
            User.countDocuments(sellerQuery),
            Product.countDocuments(productQuery),
            Payout.countDocuments({ status: 'pending' }),
            RemittanceRequest.countDocuments({ status: 'pending' })
        ]);

        res.status(200).json({
            pendingSellers,
            pendingProducts,
            pendingPayouts,
            pendingRemittances
        });
    } catch (error) {
        console.error('[getAdminDashboardCounts] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy số liệu dashboard' });
    }
};

/**
 * [Admin Only] Lấy tổng quan công nợ shipper.
 */
exports.getShipperDebtOverview = async (req, res) => {
    try {
        
        let query = { role: 'shipper' };
        if (req.user.role === 'region_manager' && req.user.region) {
            query.region = req.user.region;
        }

        const shippers = await User.find(query).select('name phone').lean();
        if (shippers.length === 0) return res.status(200).json([]);

        const shipperIds = shippers.map(s => s._id);
        const [pendingRequests, codResults, remittedResults] = await Promise.all([
            RemittanceRequest.find({ shipper: { $in: shipperIds }, status: 'pending' }).lean(),
            Order.aggregate([{ $match: { shipper: { $in: shipperIds }, status: 'Đã giao' } }, { $group: { _id: '$shipper', total: { $sum: '$total' } } }]),
            Remittance.aggregate([{ $match: { shipper: { $in: shipperIds }, status: 'completed' } }, { $group: { _id: '$shipper', total: { $sum: '$amount' } } }])
        ]);

        const pendingRequestMap = new Map();
        pendingRequests.forEach(req => {
            const shipperId = req.shipper.toString();
            if (!pendingRequestMap.has(shipperId)) pendingRequestMap.set(shipperId, []);
            pendingRequestMap.get(shipperId).push(req);
        });

        const codMap = new Map(codResults.map(item => [item._id.toString(), item.total]));
        const remittedMap = new Map(remittedResults.map(item => [item._id.toString(), item.total]));

        const debtData = shippers.map(shipper => {
            const shipperIdStr = shipper._id.toString();
            const totalCOD = codMap.get(shipperIdStr) || 0;
            const totalRemitted = remittedMap.get(shipperIdStr) || 0;
            const totalDebt = totalCOD - totalRemitted;
            return {
                ...shipper,
                totalDebt: totalDebt > 0 ? totalDebt : 0,
                pendingRequests: pendingRequestMap.get(shipperIdStr) || []
            };
        });

        debtData.sort((a, b) => {
            if (b.pendingRequests.length > a.pendingRequests.length) return 1;
            if (a.pendingRequests.length > b.pendingRequests.length) return -1;
            return b.totalDebt - a.totalDebt;
        });

        res.status(200).json(debtData);
    } catch (error) {
        console.error('[getShipperDebtOverview] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

/**
 * [Admin Only] Đếm yêu cầu nộp tiền đang chờ xử lý.
 */
exports.countPendingRemittanceRequests = async (req, res) => {
    try {
        
        const count = await RemittanceRequest.countDocuments({ status: 'pending' });
        res.status(200).json({ count });
    } catch (error) {
        console.error('[countPendingRemittanceRequests] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

/**
 * [Admin Only] Xử lý yêu cầu nộp tiền của shipper.
 */
exports.processRemittanceRequest = async (req, res) => {
    
    const { requestId } = req.params;
    const { action, adminNotes } = req.body;
    const adminId = req.user._id;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const request = await RemittanceRequest.findById(requestId)
            .populate('shipper', 'fcmToken name')
            .session(session);

        if (!request || request.status !== 'pending') {
            throw new Error('Yêu cầu không hợp lệ hoặc đã được xử lý.');
        }

        let notificationTitle = '';
        let notificationBody = '';

        if (action === 'approve') {
            if (request.isForOldDebt) {
                let amountToApply = request.amount;
                const orders = await Order.find({ shipper: request.shipper, status: 'Đã giao' }).sort({ 'timestamps.deliveredAt': 1 }).session(session);
                const allRemittances = await Remittance.find({ shipper: request.shipper, status: 'completed' }).session(session);

                const remittedMap = new Map();
                allRemittances.forEach(r => {
                    remittedMap.set(moment(r.remittanceDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD'), r.amount || 0);
                });

                const debtByDay = {};
                orders.forEach(o => {
                    const day = moment(o.timestamps.deliveredAt).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
                    debtByDay[day] = (debtByDay[day] || 0) + (o.total || 0);
                });

                const sortedDebtDays = Object.keys(debtByDay).sort();
                const todayString = moment().tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');

                for (const day of sortedDebtDays) {
                    if (amountToApply <= 0) break;
                    if (day >= todayString) continue;

                    const debtOfDay = (debtByDay[day] || 0) - (remittedMap.get(day) || 0);
                    if (debtOfDay > 0) {
                        const payment = Math.min(debtOfDay, amountToApply);
                        await Remittance.findOneAndUpdate(
                            { shipper: request.shipper, remittanceDate: moment.tz(day, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh').startOf('day').toDate() },
                            { $inc: { amount: payment }, $set: { status: 'completed' }, $push: { transactions: { amount: payment, confirmedAt: new Date(), notes: `Admin duyệt trả nợ cũ (Req: ${requestId})` } } },
                            { upsert: true, new: true, session }
                        );
                        amountToApply -= payment;
                    }
                }
            } else {
                const today = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
                await Remittance.findOneAndUpdate(
                    { shipper: request.shipper, remittanceDate: today },
                    { $inc: { amount: request.amount }, $set: { status: 'completed' }, $push: { transactions: { amount: request.amount, confirmedAt: new Date(), notes: `Admin duyệt (Req: ${requestId})` } } },
                    { upsert: true, new: true, session }
                );
            }
            request.status = 'approved';
            notificationTitle = 'Yêu cầu nộp tiền đã được duyệt';
            notificationBody = `Yêu cầu xác nhận nộp ${request.amount.toLocaleString()}đ của bạn đã được Admin chấp nhận.`;
        } else if (action === 'reject') {
            request.status = 'rejected';
            notificationTitle = 'Yêu cầu nộp tiền bị từ chối';
            notificationBody = `Yêu cầu xác nhận nộp ${request.amount.toLocaleString()}đ của bạn đã bị từ chối. Lý do: ${adminNotes || 'Không có ghi chú'}`;
        } else {
            throw new Error('Hành động không hợp lệ.');
        }

        request.adminNotes = adminNotes;
        request.processedAt = new Date();
        request.approvedBy = adminId;
        await request.save({ session });

        await session.commitTransaction();

        (async () => {
            try {
                const shipper = request.shipper;
                if (shipper) {
                    await Notification.create({
                        user: shipper._id,
                        title: notificationTitle,
                        message: notificationBody,
                        type: 'finance',
                        data: {
                            screen: 'Report',
                            remittanceRequestId: request._id.toString()
                        }
                    });

                    if (shipper.fcmToken) {
                        await safeNotify(shipper.fcmToken, {
                            title: notificationTitle,
                            body: notificationBody,
                            data: {
                                type: 'remittance_processed',
                                screen: 'Report'
                            }
                        });
                    }
                }
            } catch (e) {
                console.error('[processRemittanceRequest] Lỗi khi gửi thông báo:', e);
            }
        })();

        res.status(200).json({ message: `Đã ${action === 'approve' ? 'xác nhận' : 'từ chối'} yêu cầu thành công.` });
    } catch (error) {
        await session.abortTransaction();
        console.error('[processRemittanceRequest] Lỗi:', error);
        res.status(500).json({ message: error.message });
    } finally {
        session.endSession();
    }
};

/**
 * [Admin Only] Thanh toán lương cho shipper.
 */
exports.payShipperSalary = async (req, res) => {
    try {
        
        const { shipperId } = req.params;
        const { amount, notes } = req.body;
        const adminId = req.user._id;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Số tiền thanh toán không hợp lệ.' });
        }

        const paymentDate = new Date();
        const newPayment = new SalaryPayment({
            shipper: shipperId,
            amount: amount,
            paymentDate: paymentDate,
            paidBy: adminId,
            notes: notes
        });

        await newPayment.save();

        (async () => {
            try {
                const shipper = await User.findById(shipperId).select('fcmToken');
                if (shipper) {
                    const title = 'Bạn vừa nhận được lương';
                    const body = `Admin đã thanh toán lương cho bạn số tiền ${amount.toLocaleString('vi-VN')}đ.`;

                    await Notification.create({
                        user: shipperId,
                        title: title,
                        message: body,
                        type: 'finance',
                        data: { screen: 'Report', salaryAmount: amount }
                    });

                    if (shipper.fcmToken) {
                        await safeNotify(shipper.fcmToken, {
                            title,
                            body,
                            data: { type: 'salary_received', screen: 'Report' }
                        });
                    }
                }
            } catch (notificationError) {
                console.error('[payShipperSalary] Lỗi khi gửi thông báo:', notificationError);
            }
        })();

        res.status(201).json({ message: 'Thanh toán lương thành công!', payment: newPayment });
    } catch (error) {
        console.error('[payShipperSalary] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi thanh toán lương.' });
    }
};

/**
 * [Admin Only] Lấy chi tiết tài chính của shipper.
 */
exports.getShipperFinancialDetails = async (req, res) => {
    try {
        
        const { shipperId } = req.params;
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({ message: 'Vui lòng cung cấp tháng và năm.' });
        }

        const targetMonth = parseInt(month);
        const targetYear = parseInt(year);

        const [incomeAggregation, paymentAggregation, remittances] = await Promise.all([
            Order.aggregate([
                {
                    $match: {
                        shipper: new mongoose.Types.ObjectId(shipperId),
                        status: 'Đã giao',
                        'timestamps.deliveredAt': { $exists: true, $ne: null }
                    }
                },
                {
                    $project: {
                        income: '$shipperIncome',
                        year: { $year: { date: '$timestamps.deliveredAt', timezone: 'Asia/Ho_Chi_Minh' } },
                        month: { $month: { date: '$timestamps.deliveredAt', timezone: 'Asia/Ho_Chi_Minh' } }
                    }
                },
                { $match: { year: targetYear, month: targetMonth } },
                { $group: { _id: null, totalIncome: { $sum: '$income' } } }
            ]),
            SalaryPayment.aggregate([
                {
                    $match: {
                        shipper: new mongoose.Types.ObjectId(shipperId),
                        'paymentDate': { $exists: true, $ne: null }
                    }
                },
                {
                    $project: {
                        amount: '$amount',
                        year: { $year: { date: '$paymentDate', timezone: 'Asia/Ho_Chi_Minh' } },
                        month: { $month: { date: '$paymentDate', timezone: 'Asia/Ho_Chi_Minh' } }
                    }
                },
                { $match: { year: targetYear, month: targetMonth } },
                { $group: { _id: null, totalPaid: { $sum: '$amount' } } }
            ]),
            Remittance.find({
                shipper: new mongoose.Types.ObjectId(shipperId),
                remittanceDate: {
                    $gte: moment({ year: targetYear, month: targetMonth - 1 }).startOf('month').toDate(),
                    $lte: moment({ year: targetYear, month: targetMonth - 1 }).endOf('month').toDate()
                },
                status: 'completed'
            }).sort({ remittanceDate: -1 }).lean()
        ]);

        const totalIncome = incomeAggregation[0]?.totalIncome || 0;
        const totalSalaryPaid = paymentAggregation[0]?.totalPaid || 0;

        res.status(200).json({
            totalIncome: totalIncome,
            totalSalaryPaid: totalSalaryPaid,
            remittances: remittances
        });
    } catch (error) {
        console.error('[getShipperFinancialDetails] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

/**
 * [Admin Only] Lấy tổng quan tài chính của tất cả shipper.
 */
exports.getShipperFinancialOverview = async (req, res) => {
    try {
       
        let query = { role: 'shipper' };
        if (req.user.role === 'region_manager' && req.user.region) {
            query.region = req.user.region;
        }

        const shippers = await User.find(query).select('name phone').lean();
        if (shippers.length === 0) return res.status(200).json([]);

        const shipperIds = shippers.map(s => s._id);

        const [codResults, remittedResults, incomeResults, salaryPaidResults] = await Promise.all([
            Order.aggregate([{ $match: { shipper: { $in: shipperIds }, status: 'Đã giao' } }, { $group: { _id: '$shipper', total: { $sum: '$total' } } }]),
            Remittance.aggregate([{ $match: { shipper: { $in: shipperIds }, status: 'completed' } }, { $group: { _id: '$shipper', total: { $sum: '$amount' } } }]),
            Order.aggregate([{ $match: { shipper: { $in: shipperIds }, status: 'Đã giao' } }, { $group: { _id: '$shipper', total: { $sum: '$shipperIncome' } } }]),
            SalaryPayment.aggregate([{ $match: { shipper: { $in: shipperIds } } }, { $group: { _id: '$shipper', total: { $sum: '$amount' } } }])
        ]);

        const codMap = new Map(codResults.map(item => [item._id.toString(), item.total]));
        const remittedMap = new Map(remittedResults.map(item => [item._id.toString(), item.total]));
        const incomeMap = new Map(incomeResults.map(item => [item._id.toString(), item.total]));
        const salaryPaidMap = new Map(salaryPaidResults.map(item => [item._id.toString(), item.total]));

        const financialData = shippers.map(shipper => {
            const shipperIdStr = shipper._id.toString();
            const totalCOD = codMap.get(shipperIdStr) || 0;
            const totalRemitted = remittedMap.get(shipperIdStr) || 0;
            const codDebt = totalCOD - totalRemitted;
            const totalIncome = incomeMap.get(shipperIdStr) || 0;
            const totalSalaryPaid = salaryPaidMap.get(shipperIdStr) || 0;
            const salaryToPay = totalIncome - totalSalaryPaid;

            return {
                ...shipper,
                codDebt: codDebt > 0 ? codDebt : 0,
                salaryToPay: salaryToPay > 0 ? salaryToPay : 0
            };
        });

        financialData.sort((a, b) => {
            if (b.salaryToPay > a.salaryToPay) return 1;
            if (a.salaryToPay > b.salaryToPay) return -1;
            return b.codDebt - a.codDebt;
        });

        res.status(200).json(financialData);
    } catch (error) {
        console.error('[getShipperFinancialOverview] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

/**
 * [Admin Only] Lấy tổng quan tài chính của tất cả seller.
 */
exports.getSellerFinancialOverview = async (req, res) => {
    try {
        
        let query = { role: 'seller', approvalStatus: 'approved' };
        if (req.user.role === 'region_manager' && req.user.region) {
            query.region = req.user.region;
        }

        const sellers = await User.find(query).select('name phone commissionRate').lean();
        if (sellers.length === 0) return res.status(200).json([]);

        const sellerIds = sellers.map(s => s._id);
        const lastLedgerEntries = await LedgerEntry.aggregate([
            { $match: { seller: { $in: sellerIds } } },
            { $sort: { createdAt: -1 } },
            { $group: { _id: '$seller', lastBalance: { $first: '$balanceAfter' } } }
        ]);

        const balanceMap = new Map(lastLedgerEntries.map(item => [item._id.toString(), item.lastBalance]));

        const financialData = sellers.map(seller => {
            const sellerIdStr = seller._id.toString();
            const availableBalance = balanceMap.get(sellerIdStr) || 0;
            return {
                ...seller,
                availableBalance: availableBalance > 0 ? availableBalance : 0,
            };
        });

        financialData.sort((a, b) => b.availableBalance - a.availableBalance);

        res.status(200).json(financialData);
    } catch (error) {
        console.error('[getSellerFinancialOverview] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

/**
 * [Admin Only] Lấy chi tiết tài chính của seller.
 */
exports.getSellerComprehensiveFinancials = async (req, res) => {
    try {
        
        const { sellerId } = req.params;
        const sellerObjectId = new mongoose.Types.ObjectId(sellerId);

        const seller = await User.findById(sellerId).select('name phone paymentInfo commissionRate').lean();
        if (!seller) {
            return res.status(404).json({ message: 'Không tìm thấy seller.' });
        }

        const todayStart = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();
        const monthStart = moment().tz('Asia/Ho_Chi_Minh').startOf('month').toDate();
        const monthEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('month').toDate();

        const [
            allTimeRevenue,
            todayRevenue,
            thisMonthRevenue,
            lastLedgerEntry
        ] = await Promise.all([
            LedgerEntry.aggregate([
                { $match: { seller: sellerObjectId, type: 'credit' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            LedgerEntry.aggregate([
                { $match: { seller: sellerObjectId, type: 'credit', createdAt: { $gte: todayStart, $lte: todayEnd } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            LedgerEntry.aggregate([
                { $match: { seller: sellerObjectId, type: 'credit', createdAt: { $gte: monthStart, $lte: monthEnd } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            LedgerEntry.findOne({ seller: sellerObjectId }).sort({ createdAt: -1 }).lean()
        ]);

        const totalRevenue = allTimeRevenue[0]?.total || 0;
        const availableBalance = lastLedgerEntry?.balanceAfter || 0;
        const totalPaidOut = totalRevenue - availableBalance;

        const finalData = {
            sellerInfo: seller,
            allTime: {
                totalRevenue,
                totalPaidOut,
                availableBalance
            },
            today: {
                revenue: todayRevenue[0]?.total || 0,
            },
            thisMonth: {
                revenue: thisMonthRevenue[0]?.total || 0,
            }
        };

        res.status(200).json(finalData);
    } catch (error) {
        console.error('[getSellerComprehensiveFinancials] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy dữ liệu tài chính seller.' });
    }
};

/**
 * [Admin Only] Thanh toán cho seller.
 */
exports.payToSeller = async (req, res) => {
    try {
        
        const { sellerId } = req.params;
        const { amount, notes } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Số tiền thanh toán không hợp lệ.' });
        }
        const lastEntry = await LedgerEntry.findOne({ seller: sellerId }).sort({ createdAt: -1 });
        const currentBalance = lastEntry ? lastEntry.balanceAfter : 0;
        if (amount > currentBalance) {
            return res.status(400).json({ message: 'Số tiền thanh toán không được lớn hơn số dư hiện có của seller.' });
        }
        const newBalance = currentBalance - amount;

        await LedgerEntry.create({
            seller: sellerId,
            type: 'debit',
            amount,
            description: notes || `Admin thanh toán cho bạn`,
            balanceAfter: newBalance,
        });

        (async () => {
            try {
                const seller = await User.findById(sellerId).select('fcmToken');
                if (seller) {
                    const title = 'Bạn vừa nhận được thanh toán';
                    const body = `Admin đã thanh toán cho bạn số tiền ${amount.toLocaleString('vi-VN')}đ. Số dư của bạn đã được cập nhật.`;

                    await Notification.create({
                        user: sellerId,
                        title: title,
                        message: body,
                        type: 'payout',
                        data: { screen: 'Finance', payoutAmount: amount }
                    });

                    if (seller.fcmToken) {
                        await safeNotify(seller.fcmToken, {
                            title,
                            body,
                            data: { type: 'payout_received', screen: 'Finance' }
                        });
                    }
                }
            } catch (notificationError) {
                console.error('[payToSeller] Lỗi khi gửi thông báo:', notificationError);
            }
        })();

        res.status(201).json({ message: 'Đã ghi nhận thanh toán cho seller thành công!' });
    } catch (error) {
        console.error('[payToSeller] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi thanh toán cho seller.' });
    }
};

/**
 * [Admin Only] Lấy tất cả số liệu đang chờ xử lý.
 */
exports.getAllPendingCounts = async (req, res) => {
    try {
        
        const productQuery = { approvalStatus: 'pending_approval' };
        if (req.user.role === 'region_manager' && req.user.region) {
            const sellersInRegion = await User.find({ role: 'seller', region: req.user.region }).select('_id');
            productQuery.seller = { $in: sellersInRegion.map(s => s._id) };
        }

        const [productCount, payoutCount, remittanceCount] = await Promise.all([
            Product.countDocuments(productQuery),
            PayoutRequest.countDocuments({ status: 'pending' }),
            RemittanceRequest.countDocuments({ status: 'pending' })
        ]);

        res.status(200).json({
            pendingProducts: productCount,
            pendingPayouts: payoutCount,
            pendingRemittances: remittanceCount
        });
    } catch (error) {
        console.error('[getAllPendingCounts] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

/**
 * [Admin Only] Lấy chi tiết tài chính tổng hợp của shipper.
 */
exports.getShipperComprehensiveFinancials = async (req, res) => {
    try {
        const { shipperId } = req.params;
        const shipperObjectId = new mongoose.Types.ObjectId(shipperId);

        const shipper = await User.findById(shipperId).select('name phone paymentInfo').lean();
        if (!shipper) {
            return res.status(404).json({ message: 'Không tìm thấy shipper.' });
        }

        const todayStart = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();
        const monthStart = moment().tz('Asia/Ho_Chi_Minh').startOf('month').toDate();
        const monthEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('month').toDate();

        const [
            allTimeStats,
            todayIncome,
            thisMonthIncome,
            totalSalaryPaid
        ] = await Promise.all([
            Order.aggregate([
                { $match: { shipper: shipperObjectId, status: 'Đã giao' } },
                { $group: { _id: null, totalCodCollected: { $sum: '$total' }, totalIncome: { $sum: '$shipperIncome' } } }
            ]),
            Order.aggregate([
                { $match: { shipper: shipperObjectId, status: 'Đã giao', 'timestamps.deliveredAt': { $gte: todayStart, $lte: todayEnd } } },
                { $group: { _id: null, income: { $sum: '$shipperIncome' } } }
            ]),
            Order.aggregate([
                { $match: { shipper: shipperObjectId, status: 'Đã giao', 'timestamps.deliveredAt': { $gte: monthStart, $lte: monthEnd } } },
                { $group: { _id: null, income: { $sum: '$shipperIncome' } } }
            ]),
            SalaryPayment.aggregate([
                { $match: { shipper: shipperObjectId } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ])
        ]);

        const totalCodPaidResult = await Remittance.aggregate([
            { $match: { shipper: shipperObjectId, status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const totalCodCollected = allTimeStats[0]?.totalCodCollected || 0;
        const totalShipperIncome = allTimeStats[0]?.totalIncome || 0;
        const totalCodPaid = totalCodPaidResult[0]?.total || 0;
        const totalSalaryPaidAmount = totalSalaryPaid[0]?.total || 0;

        const finalData = {
            shipperInfo: shipper,
            allTime: {
                totalCodCollected,
                totalCodPaid,
                totalDebt: totalCodCollected - totalCodPaid,
                totalShipperIncome,
                totalSalaryPaid: totalSalaryPaidAmount,
                remainingSalary: totalShipperIncome - totalSalaryPaidAmount,
            },
            today: {
                income: todayIncome[0]?.income || 0,
            },
            thisMonth: {
                income: thisMonthIncome[0]?.income || 0,
            }
        };

        res.status(200).json(finalData);
    } catch (error) {
        console.error('[getShipperComprehensiveFinancials] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy dữ liệu tài chính.' });
    }
};

/**
 * [Admin Only] Nhắc nhở shipper nộp công nợ.
 */
exports.remindShipperToPayDebt = async (req, res) => {
    try {
        const { shipperId } = req.params;
        const { amount, message } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Công nợ không hợp lệ để nhắc.' });
        }

        const shipper = await User.findById(shipperId).select('fcmToken');
        if (!shipper) {
            return res.status(404).json({ message: 'Không tìm thấy shipper.' });
        }

        const notificationTitle = 'Yêu cầu nộp tiền COD';
        const notificationBody = message || `Admin yêu cầu bạn nộp khoản công nợ COD còn lại là ${amount.toLocaleString('vi-VN')}đ. Vui lòng hoàn tất sớm.`;

        if (shipper.fcmToken) {
            await safeNotify(shipper.fcmToken, {
                title: notificationTitle,
                body: notificationBody,
                data: { type: 'finance_reminder', screen: 'Report' }
            });
        }

        await Notification.create({
            user: shipperId,
            title: notificationTitle,
            message: notificationBody,
            type: 'finance'
        });

        res.status(200).json({ message: 'Đã gửi nhắc nhở thành công!' });
    } catch (error) {
        console.error('[remindShipperToPayDebt] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi gửi nhắc nhở.' });
    }
};

module.exports = exports;
