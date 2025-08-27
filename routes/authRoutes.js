// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const voucherController = require('../controllers/voucherController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Hàm tạo Access + Refresh token
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '30m' }
  );

  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};

// Đăng ký tài khoản
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, address, phone, location, role, fcmToken, shipperProfile } = req.body;

    if (!name || !email || !password || !address || !phone) {
      return res.status(400).json({
        status: 'error',
        message: 'Vui lòng điền đầy đủ: họ và tên, email, mật khẩu, địa chỉ, số điện thoại'
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ status: 'error', message: 'Email đã tồn tại' });
    }

    const validRoles = ['customer', 'admin', 'shipper'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ status: 'error', message: 'Role không hợp lệ' });
    }

    const userData = {
      name,
      email: email.toLowerCase().trim(),
      password,
      address,
      phone,
      role: role || 'customer',
      location: location || { type: 'Point', coordinates: [0, 0] }
    };

    if (fcmToken) {
      userData.fcmToken = fcmToken;
    }

    if (role === 'shipper') {
      if (!shipperProfile?.vehicleType || !shipperProfile?.licensePlate) {
        return res.status(400).json({ status: 'error', message: 'Thiếu thông tin phương tiện cho shipper' });
      }
      userData.shipperProfile = shipperProfile;
    }

    const user = new User(userData);
    await user.save();

    if (user.role === 'customer') {
      await voucherController.grantNewUserVoucher(user._id);
    }

    const { accessToken, refreshToken } = generateTokens(user._id);

    const userResponse = {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        role: user.role,
        isAdmin: user.role === 'admin',
        avatar: user.avatar, // Luôn gửi avatar nếu có
        shopProfile: user.shopProfile, // Luôn gửi shopProfile nếu có
        shipperProfile: user.shipperProfile, // Luôn gửi shipperProfile nếu có
        commissionRate: user.commissionRate,
        paymentInfo: user.paymentInfo,
    };
    
    if (user.role === 'shipper') {
        userResponse.shipperProfile = user.shipperProfile;
    }
    if (user.role === 'seller') {
        userResponse.commissionRate = user.commissionRate;
        userResponse.paymentInfo = user.paymentInfo;
    }

    res.status(201).json({
      status: 'success',
      data: {
        user: userResponse,
        token: accessToken,
        refreshToken
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ status: 'error', message: err.message || 'Lỗi server' });
  }
});

// Đăng nhập
router.post('/login', async (req, res) => {
  try {
    const { email, password, client_type } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Vui lòng nhập email và mật khẩu' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
        .select('+password +role +phone +address +name +email +avatar +shopProfile +shipperProfile +commissionRate +paymentInfo');
    
   if (!user) {
      return res.status(401).json({ status: 'error', message: 'Email hoặc mật khẩu không đúng' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ status: 'error', message: 'Email hoặc mật khẩu không đúng' });
    }

    const allowedRoles = {
      customer: ['customer', 'admin'],
      shipper: ['shipper'],
      seller: ['seller']
    };
    const requestClientType = client_type || 'customer'; 
    if (!allowedRoles[requestClientType] || !allowedRoles[requestClientType].includes(user.role)) {
        return res.status(403).json({
            status: 'error',
            message: 'Tài khoản của bạn không có quyền truy cập vào ứng dụng này.'
        });
    }

    const { accessToken, refreshToken } = generateTokens(user._id);
    
    const userResponse = {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        role: user.role,
        isAdmin: user.role === 'admin',
    };
    
    if (user.role === 'shipper') {
        userResponse.shipperProfile = user.shipperProfile;
        userResponse.paymentInfo = user.paymentInfo;
    }
    if (user.role === 'seller') {
        userResponse.commissionRate = user.commissionRate;
        userResponse.paymentInfo = user.paymentInfo;
    }
    
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
});

// Làm mới token
router.post('/refresh-token', async (req, res) => {
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
      data: {
        token: accessToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ status: 'error', message: 'Refresh token đã hết hạn, vui lòng đăng nhập lại' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ status: 'error', message: 'Refresh token không hợp lệ, vui lòng đăng nhập lại' });
    }
    return res.status(401).json({ status: 'error', message: 'Lỗi xác thực refresh token' });
  }
});

// Lấy thông tin người dùng hiện tại
router.get('/me', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('+role +phone +address +name +email +shipperProfile +commissionRate +paymentInfo');
        
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
        }

        const userResponse = {
            _id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            address: user.address,
            role: user.role,
            isAdmin: user.role === 'admin',
        };

        if (user.role === 'shipper') {
            userResponse.shipperProfile = user.shipperProfile;
        }
        if (user.role === 'seller') {
            userResponse.commissionRate = user.commissionRate;
            userResponse.paymentInfo = user.paymentInfo;
        }

        res.status(200).json({
            status: 'success',
            data: {
                user: userResponse 
            }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Lỗi server' });
    }
});

router.post('/register/seller', async (req, res) => {
    try {
        const { email, password, name, phone, address } = req.body;
        
        if (!name || !email || !password || !address || !phone) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin bắt buộc.' });
        }
        
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Email này đã được sử dụng.' });
        }
        
                
        const newSeller = new User({
            name,
            email: email.toLowerCase().trim(),
            password,
            address,
            phone,
            role: 'seller',
            approvalStatus: 'pending' // << QUAN TRỌNG: Tài khoản mới sẽ ở trạng thái chờ duyệt
        });
        
        await newSeller.save();
        
        // (Tùy chọn) Gửi thông báo cho tất cả Admin về việc có tài khoản mới cần duyệt
        
        res.status(201).json({ message: 'Đăng ký thành công! Tài khoản của bạn đang chờ quản trị viên phê duyệt.' });
        
    } catch (error) {
         res.status(500).json({ message: "Đã có lỗi xảy ra, vui lòng thử lại." });
    }
});


module.exports = router;
