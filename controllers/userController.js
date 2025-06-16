const mongoose = require('mongoose');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const voucherController = require('./voucherController');

exports.register = async (req, res) => {
  try {
    const { name, email, password, phone, address, role, shipperProfile, fcmToken } = req.body;

    // Kiểm tra thông tin bắt buộc
    if (!name || !email || !password || !phone || !address) {
      return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
    }

    // Kiểm tra email đã tồn tại
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email đã tồn tại' });
    }

    // Kiểm tra role hợp lệ
    const validRoles = ['customer', 'admin', 'shipper'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ message: 'Role không hợp lệ' });
    }

    // Kiểm tra thông tin shipper nếu role là shipper
    let userData = { name, email, phone, address, password, role: role || 'customer' };
    if (role === 'shipper') {
      if (!shipperProfile?.vehicleType || !shipperProfile?.licensePlate) {
        return res.status(400).json({ message: 'Thiếu thông tin phương tiện cho shipper' });
      }
      userData.shipperProfile = shipperProfile;
    }

    // Thêm fcmToken nếu có
    if (fcmToken) {
      userData.fcmToken = fcmToken;
    }

    // Tạo user mới
    const user = new User(userData);
    await user.save();

    // Cấp voucher cho khách mới nếu role là customer
    if (user.role === 'customer') {
      await voucherController.grantNewUserVoucher(user._id);
    }

    // Tạo JWT token
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });

    res.status(201).json({
      message: 'Đăng ký thành công',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        role: user.role,
        isAdmin: user.isAdmin
      }
    });
  } catch (err) {
    console.error('[register] error:', err);
    if (err instanceof mongoose.Error.ValidationError) {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password, fcmToken } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Thiếu thông tin đăng nhập' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
    }

    // Cập nhật fcmToken nếu có
    if (fcmToken && user.fcmToken !== fcmToken) {
      user.fcmToken = fcmToken;
      await user.save();
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({
      message: 'Đăng nhập thành công',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        role: user.role,
        isAdmin: user.isAdmin
      }
    });
  } catch (err) {
    console.error('[login] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.updateLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { latitude, longitude } = req.body;

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ message: 'Tọa độ location không hợp lệ' });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        location: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        locationUpdatedAt: new Date()
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: 'Người dùng không tồn tại' });
    }

    res.json({ message: 'Cập nhật vị trí thành công' });
  } catch (err) {
    console.error('[updateLocation] error:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

module.exports = { register, login, updateLocation };
