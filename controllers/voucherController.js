const Voucher = require('../models/Voucher');
const UserVoucher = require('../models/UserVoucher');
const Settings = require('../models/Settings');

// Lấy danh sách voucher có thể thu thập
exports.getAvailableVouchers = async (req, res) => {
  try {
    const userId = req.user?.id; // Lấy từ middleware xác thực
    const vouchers = await Voucher.find({
      type: { $in: ['fixed', 'percentage'] },
      isActive: true,
      isFeatured: true,
      expiryDate: { $gt: new Date() },
      currentCollects: { $lt: '$maxCollects' }
    });

    // Lọc voucher chưa được người dùng thu thập
    if (userId) {
      const collectedVouchers = await UserVoucher.find({ user: userId }).select('voucher');
      const collectedIds = collectedVouchers.map(uv => uv.voucher.toString());
      const filteredVouchers = vouchers.filter(v => !collectedIds.includes(v._id.toString()));
      return res.json(filteredVouchers);
    }

    res.json(vouchers);
  } catch (err) {
    console.error('[getAvailableVouchers] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Lấy danh sách voucher của tôi
exports.getMyVouchers = async (req, res) => {
  try {
    const userId = req.user.id;
    const userVouchers = await UserVoucher.find({ user: userId, isUsed: false })
      .populate('voucher')
      .select('voucher collectedAt');
    const vouchers = userVouchers
      .map(uv => uv.voucher)
      .filter(v => v && v.isActive && v.expiryDate > new Date());
    res.json(vouchers);
  } catch (err) {
    console.error('[getMyVouchers] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Tạo voucher (admin only)
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
    console.error('[createVoucher] error:', err);
    res.status(err.code === 11000 ? 400 : 500).json({
      message: err.code === 11000 ? 'Mã voucher đã tồn tại' : 'Lỗi server'
    });
  }
};

// Thu thập voucher (yêu cầu đăng nhập)
exports.collectVoucher = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const voucher = await Voucher.findById(id);
    if (!voucher || !voucher.isActive || voucher.expiryDate < new Date() || voucher.currentCollects >= voucher.maxCollects) {
      return res.status(400).json({ message: 'Voucher không khả dụng' });
    }

    const existing = await UserVoucher.findOne({ user: userId, voucher: id });
    if (existing) {
      return res.status(400).json({ message: 'Bạn đã thu thập voucher này' });
    }

    await UserVoucher.create({ user: userId, voucher: id });
    voucher.currentCollects += 1;
    await voucher.save();

    res.status(200).json({ message: 'Thu thập voucher thành công' });
  } catch (err) {
    console.error('[collectVoucher] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Áp dụng voucher khi thanh toán
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
    discount = Math.min(discount, shippingFee); // Không cho phí ship âm

    res.json({ message: 'Áp dụng voucher thành công', discount });
  } catch (err) {
    console.error('[applyVoucher] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Xóa voucher (admin only)
exports.deleteVoucher = async (req, res) => {
  try {
    const voucher = await Voucher.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!voucher) {
      return res.status(404).json({ message: 'Voucher không tồn tại' });
    }
    res.json({ message: 'Xóa voucher thành công' });
  } catch (err) {
    console.error('[deleteVoucher] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Cập nhật cài đặt voucher khách mới (admin only)
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

    res.json({ message: 'Cập nhật cài đặt thành công', settings });
  } catch (err) {
    console.error('[updateNewUserVoucherSettings] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Cấp voucher cho khách mới (gọi khi đăng ký tài khoản)
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
    console.error('[grantNewUserVoucher] error:', err);
  }
};
