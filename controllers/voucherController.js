const Voucher = require('../models/Voucher');
const User = require('../models/User');

exports.getAvailableVouchers = async (req, res) => {
  try {
    const vouchers = await Voucher.find({ user: null, expiresAt: { $gt: new Date() } });
    res.json(vouchers);
  } catch (err) {
    console.error('Lỗi lấy voucher có thể thu thập:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.collectVoucher = async (req, res) => {
  try {
    const voucher = await Voucher.findById(req.params.id);
    if (!voucher || voucher.user) {
      return res.status(400).json({ message: 'Voucher không khả dụng' });
    }
    if (voucher.expiresAt < new Date()) {
      return res.status(400).json({ message: 'Voucher đã hết hạn' });
    }
    voucher.user = req.user._id;
    await voucher.save();
    res.json({ message: 'Thu thập voucher thành công', voucher });
  } catch (err) {
    console.error('Lỗi thu thập voucher:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.getMyVouchers = async (req, res) => {
  try {
    const vouchers = await Voucher.find({ user: req.user._id, expiresAt: { $gt: new Date() } });
    res.json(vouchers);
  } catch (err) {
    console.error('Lỗi lấy voucher của tôi:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.applyVoucher = async (req, res) => {
  try {
    const { code } = req.body;
    const voucher = await Voucher.findOne({ code, user: req.user._id });
    if (!voucher) {
      return res.status(400).json({ message: 'Voucher không hợp lệ' });
    }
    if (voucher.expiresAt < new Date()) {
      return res.status(400).json({ message: 'Voucher đã hết hạn' });
    }
    res.json({ message: 'Áp dụng voucher thành công', voucher });
  } catch (err) {
    console.error('Lỗi áp dụng voucher:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.createVoucher = async (req, res) => {
  try {
    const { code, discount, type, expiresAt, userId } = req.body;
    if (!code || !discount || !type) {
      return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
    }
    const voucher = new Voucher({
      code,
      discount,
      type,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      user: userId || null,
    });
    await voucher.save();
    res.status(201).json(voucher);
  } catch (err) {
    console.error('Lỗi tạo voucher:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.deleteVoucher = async (req, res) => {
  try {
    const voucher = await Voucher.findByIdAndDelete(req.params.id);
    if (!voucher) {
      return res.status(404).json({ message: 'Voucher không tồn tại' });
    }
    res.json({ message: 'Xóa voucher thành công' });
  } catch (err) {
    console.error('Lỗi xóa voucher:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.updateNewUserVoucherSettings = async (req, res) => {
  try {
    const { discount, expiresDays } = req.body;
    if (!discount || !expiresDays) {
      return res.status(400).json({ message: 'Thiếu thông tin cài đặt' });
    }
    // Giả định lưu cài đặt vào DB hoặc biến toàn cục (cần thêm model nếu muốn lưu)
    res.json({ message: 'Cập nhật cài đặt voucher khách mới thành công', settings: { discount, expiresDays } });
  } catch (err) {
    console.error('Lỗi cập nhật cài đặt voucher:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.grantNewUserVoucher = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user || user.role !== 'customer') {
      return null;
    }
    const voucher = new Voucher({
      code: `NEWUSER${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      discount: 20000,
      type: 'shipping',
      user: userId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 ngày
    });
    await voucher.save();
    return voucher;
  } catch (err) {
    console.error('Lỗi cấp voucher:', err);
    return null;
  }
};

module.exports = {
  getAvailableVouchers,
  collectVoucher,
  getMyVouchers,
  applyVoucher,
  createVoucher,
  deleteVoucher,
  updateNewUserVoucherSettings,
  grantNewUserVoucher,
};
