// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const voucherController = require('../controllers/voucherController');
const { verifyToken } = require('../middlewares/authMiddleware');
const Region = require('../models/Region');
const Notification = require('../models/Notification'); // Model để lưu thông báo vào DB
const { safeNotify } = require('../utils/notificationMiddleware');

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

    // --- BẮT ĐẦU SỬA LOGIC GÁN KHU VỰC ---
    if (!location || !location.coordinates || location.coordinates.length !== 2) {
        return res.status(400).json({
            status: 'error',
            message: 'Không thể đăng ký vì không có thông tin vị trí hợp lệ.'
        });
    }

    // Tìm khu vực gần nhất với vị trí của người dùng
    const userRegion = await Region.findOne({
        isActive: true, // Chỉ tìm trong các khu vực đang hoạt động
        center: {
            $nearSphere: {
                $geometry: {
                    type: "Point",
                    coordinates: location.coordinates // [longitude, latitude]
                },
                // Có thể giới hạn khoảng cách tối đa nếu cần
                // $maxDistance: 20000 // ví dụ: 20km
            }
        }
    }).select('_id');

    if (!userRegion) {
        return res.status(400).json({ status: 'error', message: 'Rất tiếc, vị trí của bạn hiện chưa nằm trong khu vực phục vụ của chúng tôi.' });
    }
   
        // <<< KẾT THÚC LOGIC TÌM KHU VỰC >>>

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
      location: location || { type: 'Point', coordinates: [0, 0] },
      region: userRegion._id // <<< GÁN REGION ID
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

    // BƯỚC 1: LẤY USER VỚI MẬT KHẨU VÀ CÁC TRƯỜNG CẦN CHO VALIDATION
    const userForValidation = await User.findOne({ email: email.toLowerCase().trim() })
        .select('+password +role +approvalStatus +rejectionReason'); 
    
    if (!userForValidation || !userForValidation.password) {
      return res.status(401).json({ status: 'error', message: 'Email hoặc mật khẩu không đúng' });
    }

    const isMatch = await bcrypt.compare(password, userForValidation.password);
    if (!isMatch) {
      return res.status(401).json({ status: 'error', message: 'Email hoặc mật khẩu không đúng' });
    }

    // BƯỚC 2: MẬT KHẨU ĐÃ ĐÚNG, KIỂM TRA CÁC ĐIỀU KIỆN KHÁC
    if (userForValidation.role === 'seller' || userForValidation.role === 'shipper') {
        if (userForValidation.approvalStatus === 'pending') {
            return res.status(403).json({ status: 'error', message: 'Tài khoản của bạn đang chờ quản trị viên phê duyệt.' });
        }
        if (userForValidation.approvalStatus === 'rejected') {
            return res.status(403).json({ status: 'error', message: `Tài khoản của bạn đã bị từ chối. Lý do: ${userForValidation.rejectionReason || 'Không có'}` });
        }
    }

    const allowedRoles = {
      customer: ['customer', 'admin', 'region_manager'],
      shipper: ['shipper'],
      seller: ['seller']
    };
    const requestClientType = client_type || 'customer'; 
    if (!allowedRoles[requestClientType] || !allowedRoles[requestClientType].includes(userForValidation.role)) {
        return res.status(403).json({ status: 'error', message: 'Tài khoản của bạn không có quyền truy cập vào ứng dụng này.' });
    }

    // BƯỚC 3: KHI TẤT CẢ ĐỀU HỢP LỆ, LẤY LẠI TOÀN BỘ THÔNG TIN USER ĐỂ TRẢ VỀ
    const userToReturn = await User.findById(userForValidation._id);

    if (!userToReturn) {
        // Trường hợp hiếm gặp: user bị xóa ngay sau khi xác thực mật khẩu
        return res.status(401).json({ status: 'error', message: 'Tài khoản không còn tồn tại.' });
    }
    
    const { accessToken, refreshToken } = generateTokens(userToReturn._id);
    
    // <<< GIỮ LẠI HOÀN TOÀN KHỐI TẠO userResponse CỦA BẠN >>>
    const userResponse = {
        _id: userToReturn._id,
        name: userToReturn.name,
        email: userToReturn.email,
        phone: userToReturn.phone,
        address: userToReturn.address,
        role: userToReturn.role,
        isAdmin: userToReturn.role === 'admin', // Giữ lại virtual
        avatar: userToReturn.avatar, 
        shopProfile: userToReturn.shopProfile, 
        shipperProfile: userToReturn.shipperProfile, 
        commissionRate: userToReturn.commissionRate,
        paymentInfo: userToReturn.paymentInfo,
        approvalStatus: userToReturn.approvalStatus,
        rejectionReason: userToReturn.rejectionReason
    };
    
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
        // --- BẮT ĐẦU SỬA ---
        // Yêu cầu lấy tất cả các trường cần thiết
        const user = await User.findById(req.user._id)
            .select('+role +phone +address +name +email +avatar +shopProfile +shipperProfile +commissionRate +paymentInfo');
        // --- KẾT THÚC SỬA ---
        
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
        }
        
        // --- BẮT ĐẦU SỬA ---
        const userResponse = {
            _id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            address: user.address,
            role: user.role,
            isAdmin: user.role === 'admin',
            avatar: user.avatar,
            shopProfile: user.shopProfile,
            shipperProfile: user.shipperProfile,
            commissionRate: user.commissionRate,
            paymentInfo: user.paymentInfo,
        };
        // --- KẾT THÚC SỬA ---

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

// API này không cần xác thực, ai cũng có thể gọi
router.get('/regions', async (req, res) => {
    try {
        const activeRegions = await Region.find({ isActive: true }).select('name _id');
        res.status(200).json(activeRegions);
    } catch (error) {
        res.status(500).json({ message: "Lỗi server khi lấy danh sách khu vực." });
    }
});

// --- SỬA LẠI API ĐĂNG KÝ CỦA SELLER ---
router.post('/register/seller', async (req, res) => {
    try {
        const { email, password, name, phone, address, regionId } = req.body;
        
        if (!name || !email || !password || !phone || !regionId) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin, bao gồm cả khu vực hoạt động.' });
        }
        
        const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
        if (existingUser) {
            return res.status(400).json({ message: 'Email này đã được sử dụng.' });
        }
        
        const regionExists = await Region.findById(regionId);
        if (!regionExists || !regionExists.isActive) {
            return res.status(400).json({ message: 'Khu vực hoạt động không hợp lệ.' });
        }
                
        const newSeller = new User({
            name,
            email: email.toLowerCase().trim(),
            password,
            address: address || '',
            phone,
            role: 'seller',
            approvalStatus: 'pending',
            region: regionId
        });
        
        // Lưu seller mới vào database
        const savedSeller = await newSeller.save();
        
        // ==========================================================
        // <<< BẮT ĐẦU LOGIC GỬI THÔNG BÁO CHO ADMIN >>>
        // ==========================================================
        // Chạy tác vụ này bất đồng bộ để không làm chậm phản hồi trả về cho người dùng
        (async () => {
            try {
                // 1. Tìm tất cả các tài khoản Admin có fcmToken hợp lệ
                const admins = await User.find({ 
                    role: 'admin', 
                    fcmToken: { $exists: true, $ne: null } 
                });

                if (admins.length > 0) {
                    const notificationTitle = "Seller mới đăng ký";
                    const notificationBody = `Tài khoản "${savedSeller.name}" vừa đăng ký và đang chờ được phê duyệt.`;
                    
                    // 2. Tạo một mảng các promise để xử lý song song
                    const notificationPromises = admins.map(admin => {
                        // 2a. Lưu thông báo vào database cho từng Admin
                        const dbNotification = Notification.create({
                            user: admin._id,
                            title: notificationTitle,
                            message: notificationBody,
                            type: 'general', // Hoặc 'admin_task' nếu bạn muốn phân loại
                            data: {
                                screen: 'SellerApproval', // Màn hình Admin sẽ được điều hướng đến
                                sellerId: savedSeller._id.toString()
                            }
                        });

                        // 2b. Gửi push notification đến từng Admin
                        const pushNotification = safeNotify(admin.fcmToken, {
                            title: notificationTitle,
                            body: notificationBody,
                            data: {
                                screen: 'SellerApproval', // Dữ liệu đính kèm để app biết điều hướng
                                sellerId: savedSeller._id.toString()
                            }
                        });
                        
                        return Promise.all([dbNotification, pushNotification]);
                    });

                    // 3. Thực thi tất cả các promise
                    await Promise.all(notificationPromises);
                    console.log(`[New Seller Notification] Đã gửi thông báo đến ${admins.length} quản trị viên.`);
                }
            } catch (notificationError) {
                // Ghi lại lỗi nếu có vấn đề trong quá trình gửi thông báo
                console.error("[New Seller Notification] Lỗi khi gửi thông báo cho Admin:", notificationError);
            }
        })();
        // ==========================================================
        // <<< KẾT THÚC LOGIC GỬI THÔNG BÁO >>>
        // ==========================================================
        
        // Phản hồi thành công cho người dùng ngay lập tức
        res.status(201).json({ message: 'Đăng ký thành công! Tài khoản của bạn đang chờ quản trị viên phê duyệt.' });
        
    } catch (error) {
         console.error('[REGISTER SELLER ERROR]:', error);
         res.status(500).json({ message: "Đã có lỗi xảy ra khi đăng ký, vui lòng thử lại." });
    }
});


module.exports = router;
