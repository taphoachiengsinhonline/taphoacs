// routes/NotificationRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');

// ✅ API lưu fcmToken
router.post('/save-push-token', async (req, res) => {
  const userId = req.headers['x-user-id'];
  const { token } = req.body;

  if (!userId || !token) {
    return res.status(400).json({ message: 'Thiếu userId hoặc token' });
  }

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'Không tìm thấy user' });

    user.fcmToken = token;
    await user.save();

    res.json({ message: 'Lưu token thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server', error: err.message });
  }
});

module.exports = router;
