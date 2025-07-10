// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken, protect } = require('../middlewares/authMiddleware');
const bcrypt = require('bcryptjs');

// routes/userRoutes.js
router.put('/me', async (req, res) => {
    console.log('[DEBUG] --- START UPDATE PROFILE ---');
    console.log('[DEBUG] User ID from token:', req.user.id);
    console.log('[DEBUG] Request body:', req.body);

    try {
        const { name, phone, address } = req.body;
        const userId = req.user.id;

        // VÀ HƠN NỮA, HÃY KIỂM TRA LẠI DÒNG NÀY:
        // ĐẢM BẢO KHÔNG CÓ LOGIC KIỂM TRA QUYỀN VÔ LÝ
        // Ví dụ: Không được có:
        // if (userId !== req.params.id) { return res.status(403).json({ message: 'Bạn không có quyền...' }); }
        // (Bạn đang dùng /me, nên không cần req.params.id)

        // Hoặc kiểm tra:
        // if (!req.user.isAdmin && req.user.id.toString() !== userId.toString()) { ... }
        // (Bạn đang cập nhật chính mình, nên không cần kiểm tra này)


        // HÃY TẠM THỜI CHUYỂN DÒNG NÀY SANG CHẾ ĐỘ ĐƠN GIẢN NHẤT ĐỂ TEST:
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: { name, phone, address } }, // Chỉ cập nhật các trường này
            { new: true, runValidators: true } 
        ).select('-password'); 

        console.log('[DEBUG] updatedUser:', updatedUser ? 'Found' : 'Not Found');

        if (!updatedUser) {
            console.log('[DEBUG] User not found during update, this should not happen if token is valid.');
            return res.status(404).json({ message: 'Người dùng không tồn tại.' }); // Lỗi 404 này khác với lỗi bạn đang gặp
        }

        console.log('[DEBUG] Profile updated successfully.');
        res.status(200).json({ message: 'Cập nhật thông tin thành công!', user: updatedUser });

    } catch (error) {
        console.error('[User Update Profile ERROR]:', error); // Dòng này sẽ in ra lỗi gốc
        res.status(500).json({ message: error.message || 'Lỗi server khi cập nhật thông tin.' }); // Lỗi này sẽ được gửi về frontend
    } finally {
        console.log('[DEBUG] --- END UPDATE PROFILE ---');
    }
});

// PUT /api/v1/users/:id
// Cập nhật thông tin cơ bản (name, address, phone)
router.use(protect); 
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { name, address, phone } = req.body;
    // Chỉ cho phép user tự cập nhật chính họ hoặc admin
    if (req.user._id.toString() !== req.params.id && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Bạn không có quyền cập nhật người dùng này' });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, address, phone },
      { new: true, runValidators: true }
    ).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User không tồn tại' });
    }
    return res.json(user);
  } catch (err) {
    console.error('[BACKEND] update-user error:', err);
    return res.status(500).json({ message: 'Lỗi server khi cập nhật user', error: err.message });
  }
});

router.post('/change-password', async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ các trường.' });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: 'Mật khẩu mới không khớp.' });
        }
        if (newPassword.length < 6) { // Kiểm tra độ dài
            return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
        }

        const user = await User.findById(req.user.id).select('+password'); // Lấy user, bao gồm password
        if (!user) { // Trường hợp không tìm thấy user, mặc dù đã protect
            return res.status(404).json({ message: 'Người dùng không tồn tại.' });
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Mật khẩu hiện tại không chính xác.' });
        }

        user.password = newPassword; // Gán mật khẩu mới, middleware pre('save') sẽ tự hash
        await user.save();

        res.status(200).json({ message: 'Đổi mật khẩu thành công!' });
        
    } catch (error) {
        console.error('[User Change Password] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server, vui lòng thử lại.' });
    }
});



// POST /api/v1/users/update-location
// Body: { latitude, longitude }
router.post('/update-location', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    // Validate
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ message: 'Thiếu hoặc sai định dạng latitude/longitude' });
    }
    // Tìm và cập nhật
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy user' });
    }
    user.location = {
      type: 'Point',
      coordinates: [longitude, latitude]
    };
    await user.save();
    return res.json({ message: 'Cập nhật vị trí thành công' });
  } catch (err) {
    console.error('[BACKEND] update-location error:', err);
    return res.status(500).json({ message: 'Lỗi server khi cập nhật vị trí' });
  }
});


router.post('/update-fcm-token', verifyToken, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ message: 'Thiếu fcmToken' });
    }
    
    // Cập nhật token cho user đang đăng nhập
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { fcmToken },
      { new: true }
    );
    
    res.json({
      message: 'Cập nhật FCM token thành công',
      fcmToken: updatedUser.fcmToken
    });
  } catch (error) {
    console.error('Lỗi update fcmToken:', error);
    res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
});

module.exports = router;
