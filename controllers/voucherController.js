const Voucher = require('../models/Voucher');

exports.getVouchers = async (req, res) => {
  try {
    const vouchers = await Voucher.find({ type: 'shipping', isActive: true });
    res.json(vouchers);
  } catch (err) {
    console.error('[getVouchers] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.createVoucher = async (req, res) => {
  try {
    const { code, type, discount, expiryDate } = req.body;
    if (!code || !type || !discount || !expiryDate) {
      return res.status(400).json({ message: 'Thiếu thông tin voucher' });
    }
    if (new Date(expiryDate) < Date.now()) {
      return res.status(400).json({ message: 'Ngày hết hạn không hợp lệ' });
    }

    const voucher = new Voucher({ code, type, discount, expiryDate });
    await voucher.save();
    res.status(201).json({ message: 'Tạo voucher thành công', voucher });
  } catch (err) {
    console.error('[createVoucher] error:', err);
    res.status(err.code === 11000 ? 400 : 500).json({ message: err.code === 11000 ? 'Mã voucher đã tồn tại' : 'Lỗi server' });
  }
};

exports.applyVoucher = async (req, res) => {
  try {
    const { code, type } = req.body;
    if (!code || !type) {
      return res.status(400).json({ message: 'Thiếu mã hoặc loại voucher' });
    }

    const voucher = await Voucher.findOne({ code, type, isActive: true });
    if (!voucher) {
      return res.status(400).json({ message: 'Mã voucher không hợp lệ' });
    }
    if (new Date(voucher.expiryDate) < Date.now()) {
      return res.status(400).json({ message: 'Voucher đã hết hạn' });
    }

    res.json({ message: 'Áp dụng voucher thành công', discount: voucher.discount });
  } catch (err) {
    console.error('[applyVoucher] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

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
