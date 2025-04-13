// routes/NotificationRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.post('/save-push-token', async (req, res) => {
  const userId = req.headers['x-user-id'];
  const { token } = req.body;

  if (!userId || !token) {
    return res.status(400).json({ message: 'Thiếu userId hoặc token' });
  }

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'Không tìm thấy người dùng' });

    user.pushToken = token;
    await user.save();

    res.json({ message: 'Đã lưu token thành công' });
  } catch (error) {
    console.error('Lỗi khi lưu token:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

module.exports = router;

