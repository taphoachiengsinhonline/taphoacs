// routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Model dùng để lưu push token

// Route lưu push token khi user đăng nhập
router.post('/save-push-token', async (req, res) => {
  // Sử dụng fallback nếu req.body không tồn tại
  const { token } = req.body || {};
  // Lấy userId từ header (theo cấu hình của bạn)
  const userId = req.headers['x-user-id'];

  // Nếu không có userId thì trả về lỗi 400
  if (!userId) {
    return res.status(400).json({ message: 'Thiếu userId' });
  }

  // Nếu không có token, trả về thành công với thông báo cụ thể
  if (!token) {
    return res.status(200).json({ success: true, message: 'Không có push token để lưu.' });
  }

  try {
    // Cập nhật document của user với trường expoPushToken
    await User.findByIdAndUpdate(userId, { expoPushToken: token });
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi lưu push token', error: err.message });
  }
});

module.exports = router;
