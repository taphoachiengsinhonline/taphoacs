// routes/NotificationRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/save-push-token', verifyToken, async (req, res) => {
  const { token } = req.body;
  
  console.log(`[SAVE-PUSH-TOKEN] User: ${req.user._id}, Token: ${token}`);

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

    // Chỉ cập nhật nếu token mới
    if (user.fcmToken !== token) {
      user.fcmToken = token;
      await user.save();
      console.log(`[SAVE-PUSH-TOKEN] Updated token for user ${user._id}`);
    }

    res.json({ 
      success: true,
      message: 'Lưu FCM token thành công' 
    });
  } catch (err) {
    console.error('[SAVE-PUSH-TOKEN] error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Lỗi server',
      error: err.message 
    });
  }
});

module.exports = router;
