// routes/admin.js
const router = require('express').Router();
const User = require('../models/User');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware'); // Thêm dòng này
const bcrypt = require('bcrypt');
router.post('/shippers', verifyToken, isAdmin, async (req, res) => {
  try {
    // Phân tích req.body, lấy shipperProfile
    const { email, password, name, phone, address, shipperProfile } = req.body;
    
    // Lấy vehicleType và licensePlate từ shipperProfile
    const { vehicleType, licensePlate } = shipperProfile || {};

    // Kiểm tra xem các trường bắt buộc có được cung cấp không
    if (!email || !password || !name || !phone || !address || !vehicleType || !licensePlate) {
      return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ thông tin' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email đã tồn tại' });
    }

    const shipper = new User({
      email,
      password,
      name,
      address,
      phone,
      role: 'shipper',
      shipperProfile: {
        vehicleType,
        licensePlate
      }
    });

    await shipper.save();

    res.status(201).json({
      _id: shipper._id,
      email: shipper.email,
      role: shipper.role,
      shipperProfile: shipper.shipperProfile
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}); 
module.exports = router;
