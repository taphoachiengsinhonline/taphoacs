// File: controllers/authController.js

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const voucherController = require('./voucherController'); // Đảm bảo đường dẫn đúng
const { sendOtpEmail } = require('../utils/mailer');

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

    // 1. Trường hợp request gửi từ App Shipper riêng biệt (có truyền client_type: 'shipper')
    if (client_type === 'shipper') {
        if (userRole !== 'shipper') {
            return res.status(403).json({
                status: 'error',
                message: 'Chỉ tài khoản Tài xế (Shipper) mới được đăng nhập vào ứng dụng này.'
            });
        }
    } 
    // 2. Trường hợp request gửi từ Super App (Khách + Seller + Admin)
    else {
        // CẤM Shipper đăng nhập vào Super App
        if (userRole === 'shipper') {
            return res.status(403).json({
                status: 'error',
                message: 'Tài khoản của bạn là Shipper. Vui lòng đăng nhập trên App dành riêng cho Tài xế.'
            });
        }
        // Tất cả các role còn lại (customer, seller, admin, region_manager) đều được đi tiếp qua cửa này!
    }


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

// Thêm import này lên đầu file nếu chưa có:
// const { sendOtpEmail } = require('../utils/mailer');

exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'Vui lòng cung cấp email.' });

        const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
        if (!user) return res.status(404).json({ message: 'Không tìm thấy tài khoản với email này.' });

        // Tạo mật khẩu mới ngẫu nhiên (6 chữ số)
        const newTempPassword = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Gửi email
        const mailSubject = "Khôi phục mật khẩu - Bách Hóa Giao Ngay";
        const mailContent = `
            <h2>Xin chào ${user.name},</h2>
            <p>Hệ thống đã nhận được yêu cầu khôi phục mật khẩu của bạn.</p>
            <p>Mật khẩu mới tạm thời của bạn là: <strong>${newTempPassword}</strong></p>
            <p>Vui lòng đăng nhập bằng mật khẩu này và đổi lại mật khẩu mới trong phần Tài khoản của bạn để đảm bảo an toàn.</p>
        `;
        
        // Giả sử bạn đang dùng hàm sendOtpEmail (hoặc hàm gửi mail chung) trong thư mục mailer
        // Nếu hàm sendOtpEmail của bạn chỉ nhận 2 tham số (email, otp), bạn có thể gửi thẳng newTempPassword
        const isSent = await sendOtpEmail(user.email, newTempPassword); 
        
        if (!isSent) {
            return res.status(500).json({ message: 'Không thể gửi email. Vui lòng thử lại sau.' });
        }

        // Chỉ lưu mật khẩu mới vào DB nếu đã gửi mail thành công
        user.password = newTempPassword; // Mongoose middleware sẽ tự động hash nó
        await user.save();

        res.status(200).json({ message: 'Đã gửi mật khẩu mới vào email của bạn.' });

    } catch (error) {
        console.error('[forgotPassword] Lỗi:', error);
        res.status(500).json({ message: 'Lỗi server khi khôi phục mật khẩu.' });
    }
};
