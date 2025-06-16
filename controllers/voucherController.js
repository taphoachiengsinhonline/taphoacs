const Voucher = require('../models/Voucher');
const UserVoucher = require('../models/UserVoucher');

// Lấy danh sách voucher có thể thu thập
exports.getAvailableVouchers = async (req, res) => {
  try {
    const vouchers = await Voucher.find({
      type: 'shipping',
      isActive: true,
      expiryDate: { $gt: new Date() },
      currentCollects: { $lt: 'maxCollects' }
    });
    res.json(vouchers);
  } catch (err) {
    console.error('[getAvailableVouchers] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Tạo voucher (admin only)
exports.createVoucher = async (req, res) => {
  try {
    const { code, type, discount, expiryDate, maxCollects, isFeatured, isNewUserVoucher } = req.body;
    if (!code || !type || !discount || !expiryDate || !maxCollects) {
      return res.status(400).json({ message: 'Thiếu thông tin voucher' });
    }
    if (new Date(expiryDate) < Date.now()) {
      return res.status(400).json({ message: 'Ngày hết hạn không hợp lệ' });
    }

    const voucher = new Voucher({
      code,
      type,
      discount,
      expiryDate,
      maxCollects,
      isFeatured,
      isNewUserVoucher
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

// Áp dụng voucher
exports.applyVoucher = async (req, res) => {
  try {
    const { code, type } = req.body;
    if (!code || !type) {
      return res.status(400).json({ message: 'Thiếu mã hoặc loại voucher' });
    }

    const voucher = await Voucher.findOne({ code, type, isActive: true });
    if (!voucher || voucher.expiryDate < new Date()) {
      return res.status(400).json({ message: 'Voucher không hợp lệ hoặc đã hết hạn' });
    }

    res.json({ message: 'Áp dụng voucher thành công', discount: voucher.discount });
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

// Lấy voucher của tôi (yêu cầu đăng nhập)
exports.getMyVouchers = async (req, res) => {
  try {
    const userId = req.user.id;
    const userVouchers = await UserVoucher.find({ user: userId }).populate('voucher');
    res.json(userVouchers.map(uv => uv.voucher));
  } catch (err) {
    console.error('[getMyVouchers] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
