// routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../models/User'); // để lưu push token
const { verifyToken } = require('../middleware/authMiddleware');

// Lưu Push Token khi user đăng nhập
router.post('/save-push-token', verifyToken, async (req, res) => {
  const userId = req.user._id;
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ message: 'Thiếu token' });
  }

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'Không tìm thấy người dùng' });

    // Lưu token (nếu khác thì mới cập nhật)
    if (user.pushToken !== token) {
      user.pushToken = token;
      await user.save();
    }

    res.json({ message: 'Lưu token thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

module.exports = router;
