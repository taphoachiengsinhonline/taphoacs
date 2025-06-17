const Voucher = require('../models/Voucher');
const UserVoucher = require('../models/UserVoucher');
const Settings = require('../models/Settings');
const crypto = require('crypto');


exports.createBulkVouchers = async (req, res) => {
  try {
    const { vouchers } = req.body; // Expect array of voucher objects
    if (!Array.isArray(vouchers) || vouchers.length === 0) {
      return res.status(400).json({ message: 'Vouchers array is required' });
    }

    // Validate and create vouchers
    const createdVouchers = await Voucher.insertMany(
      vouchers.map(voucher => ({
        ...voucher,
        createdBy: req.user._id,
        createdAt: new Date(),
        updatedAt: new Date()
      }))
    );

    res.status(201).json({
      message: 'Vouchers được tạo thành công',
      vouchers: createdVouchers
    });
  } catch (error) {
    console.error('Error creating bulk vouchers:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};



// Lấy danh sách voucher có thể thu thập
exports.getAvailableVouchers = async (req, res) => {
  try {
    const userId = req.user?.id;
    const vouchers = await Voucher.find({
      type: { $in: ['fixed', 'percentage'] },
      isActive: true,
      isFeatured: true,
      expiryDate: { $gt: new Date() },
      $expr: { $lt: ['$currentCollects', '$maxCollects'] }
    });

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

// Tạo một voucher (admin only)
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

// Tạo hàng loạt voucher (admin only)
exports.createBulkVouchers = async (req, res) => {
  try {
    const { quantity, type, value, expiryDate, maxCollects, isFeatured } = req.body;
    if (!quantity || !type || !value || !expiryDate || !maxCollects) {
      return res.status(400).json({ message: 'Thiếu thông tin cần thiết' });
    }
    if (!['fixed', 'percentage'].includes(type)) {
      return res.status(400).json({ message: 'Loại giảm giá không hợp lệ' });
    }
    if (parseInt(quantity) <= 0 || parseInt(value) <= 0 || parseInt(maxCollects) <= 0) {
      return res.status(400).json({ message: 'Số lượng, giá trị giảm, và số lần thu thập phải lớn hơn 0' });
    }
    if (new Date(expiryDate) <= new Date()) {
      return res.status(400).json({ message: 'Thời hạn sử dụng phải là ngày trong tương lai' });
    }

    const vouchers = [];
    for (let i = 0; i < quantity; i++) {
      vouchers.push({
        code: `SHIP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        type,
        value: parseInt(value),
        expiryDate: new Date(expiryDate),
        maxCollects: parseInt(maxCollects),
        currentCollects: 0,
        isActive: true,
        isFeatured: isFeatured || false,
        applicableTo: 'shipping'
      });
    }

    const createdVouchers = await Voucher.insertMany(vouchers);
    res.status(201).json({ message: `Tạo ${quantity} voucher thành công`, vouchers: createdVouchers });
  } catch (err) {
    console.error('[createBulkVouchers] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
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
    discount = Math.min(discount, shippingFee);

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


exports.getAllVouchers = async (req, res) => {
  try {
    const vouchers = await Voucher.find().sort({ createdAt: -1 });
    res.status(200).json({
      message: 'Lấy danh sách voucher thành công',
      vouchers
    });
  } catch (error) {
    console.error('[getAllVouchers] error:', error);
    res.status(500).json({ message: 'Lỗi server', error: error.message });
  }
};
