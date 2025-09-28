// File: controllers/authController.js

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const voucherController = require('./voucherController'); // Đảm bảo đường dẫn đúng

// Hàm tạo Access + Refresh token (có thể tái sử dụng)
const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const refreshToken = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
};

// Xử lý đăng nhập
exports.login = async (req, res) => {
  try {
    const { email, password, client_type } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Vui lòng nhập email và mật khẩu' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
        .populate('region', 'name')
        .select('+password +role +phone +address +name +email +avatar +shopProfile +shipperProfile +commissionRate +paymentInfo +approvalStatus +rejectionReason');

    if (!user) {
      return res.status(401).json({ status: 'error', message: 'Email hoặc mật khẩu không đúng' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ status: 'error', message: 'Email hoặc mật khẩu không đúng' });
    }

    if ((user.role === 'seller' || user.role === 'shipper') && user.approvalStatus !== 'approved') {
        if (user.approvalStatus === 'pending') {
            return res.status(403).json({ status: 'error', message: 'Tài khoản của bạn đang chờ phê duyệt.' });
        }
        if (user.approvalStatus === 'rejected') {
            return res.status(403).json({ status: 'error', message: `Tài khoản của bạn đã bị từ chối. Lý do: ${user.rejectionReason || 'Không có'}` });
        }
    }

    // --- BẮT ĐẦU SỬA LOGIC KIỂM TRA QUYỀN TRUY CẬP (PHIÊN BẢN HOÀN CHỈNH) ---
    const allowedRoles = {
      customer: ['customer', 'admin', 'region_manager'],
      shipper: ['shipper'],
      seller: ['seller']
    };

    // Nếu client_type được gửi lên, sử dụng nó. Nếu không, mặc định là 'customer'.
    const requestClientType = client_type || 'customer'; 
    const userRole = user.role;

    // Kiểm tra xem client_type có hợp lệ không
    if (!allowedRoles[requestClientType]) {
        return res.status(400).json({
            status: 'error',
            message: 'Loại ứng dụng không hợp lệ.'
        });
    }
    
    // Kiểm tra xem vai trò của người dùng có được phép đăng nhập vào loại ứng dụng này không
    if (!allowedRoles[requestClientType].includes(userRole)) {
        return res.status(403).json({
            status: 'error',
            message: 'Tài khoản của bạn không có quyền truy cập vào ứng dụng này.'
        });
    }
    // --- KẾT THÚC SỬA LOGIC ---

    const { accessToken, refreshToken } = generateTokens(user._id);
    
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(200).json({
      status: 'success',
      data: {
        user: userResponse,
        token: accessToken,
        refreshToken
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ status: 'error', message: 'Lỗi server' });
  }
};

// Làm mới token
exports.refreshToken = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ status: 'error', message: 'Thiếu refresh token' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
     return res.status(401).json({ status: 'error', message: 'Người dùng không tồn tại' });
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id);
    return res.status(200).json({
      status: 'success',
      data: { token: accessToken, refreshToken: newRefreshToken }
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ status: 'error', message: 'Refresh token đã hết hạn, vui lòng đăng nhập lại' });
    }
    return res.status(401).json({ status: 'error', message: 'Lỗi xác thực refresh token' });
  }
};

// Lấy thông tin người dùng hiện tại
exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate('region', 'name'); // <<< SỬA LỖI QUAN TRỌNG Ở ĐÂY

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
        }
        
        res.status(200).json({
            status: 'success',
            data: { user }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Lỗi server' });
    }
};
