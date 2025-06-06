// routes/NotificationRoutes.js
// routes/NotificationRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken } = require('../middlewares/authMiddleware'); // Thêm middleware

// ✅ API lưu fcmToken
router.post('/save-push-token', verifyToken, async (req, res) => { // Thêm middleware
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ 
      success: false,
      message: 'Thiếu FCM token' 
    });
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'Người dùng không tồn tại' 
      });
    }

    user.fcmToken = token;
    await user.save();

    res.json({ 
      success: true,
      message: 'Lưu FCM token thành công' 
    });
  } catch (err) {
    console.error('[savePushToken] error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Lỗi server',
      error: err.message 
    });
  }
});

module.exports = router;
