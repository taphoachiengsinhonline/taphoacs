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
  // === LOG DEBUG TOÀN DIỆN ===
  console.log("--- BẮT ĐẦU XỬ LÝ ĐĂNG NHẬP ---");
  console.log("1. Body nhận được:", JSON.stringify(req.body, null, 2));

  try {
    const { email, password, client_type } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Vui lòng nhập email và mật khẩu' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
        .populate('region', 'name')
        // Thêm select('role') một cách tường minh để đảm bảo nó luôn được lấy
        .select('+password role phone address name email avatar shopProfile shipperProfile commissionRate paymentInfo approvalStatus rejectionReason');

    console.log("2. Tìm thấy User trong DB:", user ? `Có, role: ${user.role}` : "Không");

    if (!user) {
      return res.status(401).json({ status: 'error', message: 'Email hoặc mật khẩu không đúng' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    console.log("3. So sánh mật khẩu:", isMatch ? "Thành công" : "Thất bại");
    
    if (!isMatch) {
      return res.status(401).json({ status: 'error', message: 'Email hoặc mật khẩu không đúng' });
    }

    // ... (logic kiểm tra approvalStatus giữ nguyên) ...
    console.log("4. Trạng thái phê duyệt:", user.approvalStatus);

    // --- LOGIC KIỂM TRA QUYỀN TRUY CẬP ĐÃ ĐƯỢC ĐƠN GIẢN HÓA ---
    const requestClientType = client_type || 'customer';
    const userRole = user.role;
    
    console.log(`5. Bắt đầu kiểm tra quyền: Client Type='${requestClientType}', User Role='${userRole}'`);

    let hasPermission = false;
    if (requestClientType === 'seller' && userRole === 'seller') {
        hasPermission = true;
    } else if (requestClientType === 'shipper' && userRole === 'shipper') {
        hasPermission = true;
    } else if (requestClientType === 'customer' && ['customer', 'admin', 'region_manager'].includes(userRole)) {
        hasPermission = true;
    }

    console.log("6. Kết quả kiểm tra quyền:", hasPermission ? "CÓ QUYỀN" : "KHÔNG CÓ QUYỀN");

    if (!hasPermission) {
        return res.status(403).json({
            status: 'error',
            message: 'Tài khoản của bạn không có quyền truy cập vào ứng dụng này.'
        });
    }
    // --- KẾT THÚC LOGIC KIỂM TRA QUYỀN ---
    
    console.log("7. Tạo token và trả về response...");
    const { accessToken, refreshToken } = generateTokens(user._id);
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(200).json({
      status: 'success',
      data: { user: userResponse, token: accessToken, refreshToken }
    });
    console.log("--- KẾT THÚC XỬ LÝ ĐĂNG NHẬP THÀNH CÔNG ---");

  } catch (err) {
    console.error('Login error:', err);
    console.log("--- KẾT THÚC XỬ LÝ ĐĂNG NHẬP VỚI LỖI ---");
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
