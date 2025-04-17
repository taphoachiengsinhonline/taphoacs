const express = require('express');
const router = express.Router();
const User = require('../models/User');

// PUT /users/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, phone, address },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User không tồn tại' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server khi cập nhật user', error: err.message });
  }
});

module.exports = router;

