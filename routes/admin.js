// routes/admin.js
const router = require('express').Router();
const User = require('../models/User');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware'); // Thêm dòng này
const bcrypt = require('bcrypt');
router.post('/shippers', verifyToken, isAdmin, async (req, res) => {
  try {
    const { email, password, name, phone, address, vehicleType, licensePlate } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email đã tồn tại' });
    }

    const shipper = new User({
      email,
      password: await bcrypt.hash(password, 10),
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
