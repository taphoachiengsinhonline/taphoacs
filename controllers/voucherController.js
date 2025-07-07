const mongoose = require('mongoose');
const Voucher = require('../models/Voucher');
const UserVoucher = require('../models/UserVoucher');
const Settings = require('../models/Settings');
const crypto = require('crypto');

exports.createBulkVouchers = async (req, res) => {
  try {
    const { vouchers } = req.body;
    if (!Array.isArray(vouchers) || vouchers.length === 0) {
      return res.status(400).json({ message: 'Yêu cầu mảng vouchers không rỗng' });
    }
    const createdVouchers = await Voucher.insertMany(
      vouchers.map(voucher => ({
        ...voucher,
        createdBy: req.user._id,
        createdAt: new Date(),
        updatedAt: new Date()
      }))
    );
    res.status(201).json({
      message: 'Tạo vouchers thành công',
      vouchers: createdVouchers
    });
  } catch (error) {
    console.error('[createBulkVouchers] Lỗi:', error);
    res.status(500).json({ message: 'Lỗi server', error: error.message });
  }
};

exports.getAvailableVouchers = async (req, res) => {
    try {
        const userId = req.user._id; // Lấy từ protect middleware
        const now = new Date();

        // Lấy tất cả voucher nổi bật, còn hạn, còn lượt
        const availableVouchers = await Voucher.find({
            isActive: true,
            isFeatured: true,
            expiryDate: { $gt: now },
            $expr: { $lt: ["$currentCollects", "$maxCollects"] }
        });

        // Lấy ID của các voucher người dùng đã thu thập
        const collectedVoucherDocs = await UserVoucher.find({ user: userId }).select('voucher -_id');
        const collectedVoucherIds = new Set(collectedVoucherDocs.map(uv => uv.voucher.toString()));

        // Lọc ra những voucher người dùng CHƯA thu thập
        const finalVouchers = availableVouchers.filter(v => !collectedVoucherIds.has(v._id.toString()));

        res.status(200).json(finalVouchers);
    } catch (err) {
        console.error('[getAvailableVouchers] Lỗi:', err);
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

exports.getMyVouchers = async (req, res) => {
    try {
        const userId = req.user._id;
        const now = new Date();
        
        // Lấy các UserVoucher mà voucher của nó còn hoạt động và còn hạn
        const userVouchers = await UserVoucher.find({ user: userId, isUsed: false })
            .populate({
                path: 'voucher',
                match: { isActive: true, expiryDate: { $gt: now } }
            });
        
        // Lọc bỏ những kết quả mà populate không thành công (do voucher không khớp điều kiện)
        const validVouchers = userVouchers
            .filter(uv => uv.voucher) // Chỉ giữ lại những cái có voucher hợp lệ
            .map(uv => uv.voucher);

        res.status(200).json(validVouchers);
    } catch (err) {
        console.error('[getMyVouchers] Lỗi:', err);
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

exports.createVoucher = async (req, res) => {
  try {
    const { code, type, value, expiryDate, maxCollects, isFeatured, isNewUserVoucher } = req.body;
    if (!code || !type || !value || !expiryDate || !maxCollects) {
      return res.status(400).json({ message: 'Thiếu thông tin voucher' });
    }
    if (new Date(expiryDate) < Date.now()) {
      return res.status(400).json({ message: 'Ngày hết hạn không hợp lệ' });
    }
    if (type === 'percentage' && (value < 0 || value > 100)) {
      return res.status(400).json({ message: 'Phần trăm giảm không hợp lệ' });
    }
    const voucher = new Voucher({
      code: code.toUpperCase(),
      type,
      value,
      expiryDate,
      maxCollects,
      isFeatured,
      isNewUserVoucher,
      applicableTo: 'shipping'
    });
    await voucher.save();
    res.status(201).json({ message: 'Tạo voucher thành công', voucher });
  } catch (err) {
    console.error('[createVoucher] Lỗi:', err);
    res.status(err.code === 11000 ? 400 : 500).json({
      message: err.code === 11000 ? 'Mã voucher đã tồn tại' : 'Lỗi server'
    });
  }
};

exports.collectVoucher = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const voucherId = req.params.id;
        const userId = req.user._id;

        const voucher = await Voucher.findById(voucherId).session(session);

        if (!voucher) {
            return res.status(404).json({ message: 'Voucher không tồn tại.' });
        }
        if (!voucher.isActive || voucher.expiryDate < new Date()) {
            return res.status(400).json({ message: 'Voucher đã hết hạn hoặc không hoạt động.' });
        }
        if (voucher.currentCollects >= voucher.maxCollects) {
            return res.status(400).json({ message: 'Voucher đã hết lượt thu thập.' });
        }
        
        const existingUserVoucher = await UserVoucher.findOne({ user: userId, voucher: voucherId }).session(session);
        if (existingUserVoucher) {
            return res.status(400).json({ message: 'Bạn đã thu thập voucher này rồi.' });
        }

        // Tạo UserVoucher và tăng lượt đếm trong một transaction để đảm bảo an toàn
        await UserVoucher.create([{ user: userId, voucher: voucherId }], { session });
        voucher.currentCollects += 1;
        await voucher.save({ session });

        await session.commitTransaction();
        res.status(200).json({ message: 'Thu thập voucher thành công.' });

    } catch (err) {
        await session.abortTransaction();
        console.error('[collectVoucher] Lỗi:', err);
        res.status(500).json({ message: 'Lỗi server khi thu thập voucher.' });
    } finally {
        session.endSession();
    }
};

// applyVoucher không cần sửa, nó đã đúng logic.
exports.applyVoucher = async (req, res) => {
  try {
    const { voucherId, shippingFee } = req.body;
    const userId = req.user.id;
    const userVoucher = await UserVoucher.findOne({ user: userId, voucher: voucherId, isUsed: false });
    if (!userVoucher) {
      return res.status(400).json({ message: 'Voucher không hợp lệ hoặc đã sử dụng' });
    }
    const voucher = await Voucher.findById(voucherId);
    if (!voucher || !voucher.isActive || voucher.expiryDate < new Date()) {
      return res.status(400).json({ message: 'Voucher không khả dụng' });
    }
    let discount = 0;
    if (voucher.type === 'fixed') {
      discount = voucher.value;
    } else if (voucher.type === 'percentage') {
      discount = (voucher.value / 100) * shippingFee;
    }
    discount = Math.min(discount, shippingFee);
    res.status(200).json({ message: 'Áp dụng voucher thành công', discount });
  } catch (err) {
    console.error('[applyVoucher] Lỗi:', err);
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
};

exports.deleteVoucher = async (req, res) => {
  try {
    const voucher = await Voucher.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!voucher) {
      return res.status(404).json({ message: 'Voucher không tồn tại' });
    }
    res.status(200).json({ message: 'Xóa voucher thành công' });
  } catch (err) {
    console.error('[deleteVoucher] Lỗi:', err);
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
};

exports.updateNewUserVoucherSettings = async (req, res) => {
  try {
    const { newUserVoucherId, newUserVoucherEnabled } = req.body;
    if (newUserVoucherEnabled && !newUserVoucherId) {
      return res.status(400).json({ message: 'Thiếu ID voucher cho khách mới' });
    }
    if (newUserVoucherId) {
      const voucher = await Voucher.findById(newUserVoucherId);
      if (!voucher || !voucher.isNewUserVoucher) {
        return res.status(400).json({ message: 'Voucher không hợp lệ cho khách mới' });
      }
    }
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }
    settings.newUserVoucherId = newUserVoucherEnabled ? newUserVoucherId : null;
    settings.newUserVoucherEnabled = newUserVoucherEnabled;
    await settings.save();
    res.status(200).json({ message: 'Cập nhật cài đặt thành công', settings });
  } catch (err) {
    console.error('[updateNewUserVoucherSettings] Lỗi:', err);
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
};

exports.grantNewUserVoucher = async (userId) => {
  try {
    const settings = await Settings.findOne();
    if (!settings || !settings.newUserVoucherEnabled || !settings.newUserVoucherId) {
      return;
    }
    const voucher = await Voucher.findById(settings.newUserVoucherId);
    if (!voucher || !voucher.isActive || voucher.expiryDate < new Date() || voucher.currentCollects >= voucher.maxCollects) {
      return;
    }
    const existing = await UserVoucher.findOne({ user: userId, voucher: voucher._id });
    if (existing) {
      return;
    }
    await UserVoucher.create({ user: userId, voucher: voucher._id });
    voucher.currentCollects += 1;
    await voucher.save();
  } catch (err) {
    console.error('[grantNewUserVoucher] Lỗi:', err);
  }
};

exports.getAllVouchers = async (req, res) => {
  try {
    const query = {};
    if (req.query.applicableTo) {
      query.applicableTo = req.query.applicableTo;
    }
    const vouchers = await Voucher.find(query).sort({ createdAt: -1 });
    res.status(200).json({
      message: 'Lấy danh sách voucher thành công',
      vouchers
    });
  } catch (error) {
    console.error('[getAllVouchers] Lỗi:', error);
    res.status(500).json({ message: 'Lỗi server', error: error.message });
  }
};

exports.getVoucherById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID voucher không hợp lệ' });
    }
    const voucher = await Voucher.findById(id);
    if (!voucher) {
      return res.status(404).json({ message: 'Voucher không tồn tại' });
    }
    res.status(200).json({ message: 'Lấy voucher thành công', voucher });
  } catch (error) {
    console.error('[getVoucherById] Lỗi:', error);
    res.status(500).json({ message: 'Lỗi server', error: error.message });
  }
};

exports.updateVoucher = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID voucher không hợp lệ' });
    }
    const updates = req.body;
    const voucher = await Voucher.findByIdAndUpdate(id, updates, { new: true });
    if (!voucher) {
      return res.status(404).json({ message: 'Voucher không tồn tại' });
    }
    res.status(200).json({ message: 'Cập nhật voucher thành công', voucher });
  } catch (error) {
    console.error('[updateVoucher] Lỗi:', error);
    res.status(500).json({ message: 'Lỗi server', error: error.message });
  }
};
