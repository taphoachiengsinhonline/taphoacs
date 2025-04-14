// routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const User = require('./models/User'); // để lưu push token
const { verifyToken } = require('./middleware/authMiddleware');

// Lưu Push Token khi user đăng nhập
router.post('/save-push-token', async (req, res) => {
  const { token } = req.body;
  const userId = req.headers['x-user-id'];

  if (!userId || !token) {
    return res.status(400).json({ message: 'Thiếu userId hoặc token' });
  }

  try {
    await User.findByIdAndUpdate(userId, { expoPushToken: token });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lưu push token', error: err.message });
  }
});


module.exports = router;
