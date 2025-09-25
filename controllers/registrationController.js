// File: controllers/registrationController.js

const User = require('../models/User');
const Region = require('../models/Region');
const Notification = require('../models/Notification');
const { safeNotify } = require('../utils/notificationMiddleware');
const voucherController = require('./voucherController'); // Đảm bảo đường dẫn đúng

// Hàm tạo Access + Refresh token (có thể cần cho các luồng đăng ký phức tạp sau này)
const generateTokens = (userId) => {
  const accessToken = require('jsonwebtoken').sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const refreshToken = require('jsonwebtoken').sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
};

// Đăng ký tài khoản customer (và các role đơn giản khác)
exports.registerUser = async (req, res) => {
  try {
    const { name, email, password, address, phone, location, role, fcmToken, shipperProfile } = req.body;

    if (!name || !email || !password || !address || !phone) {
      return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin bắt buộc' });
    }

    if (!location || !location.coordinates || location.coordinates.length !== 2) {
        return res.status(400).json({ message: 'Không có thông tin vị trí hợp lệ.' });
    }

    const userRegion = await Region.findOne({
        isActive: true,
        center: { $nearSphere: { $geometry: { type: "Point", coordinates: location.coordinates } } }
    }).select('_id');

    if (!userRegion) {
        return res.status(400).json({ message: 'Vị trí của bạn chưa nằm trong khu vực phục vụ.' });
    }
   
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ message: 'Email đã tồn tại' });
    }

    const userData = {
      name, email: email.toLowerCase().trim(), password, address, phone,
      role: role || 'customer',
      location, region: userRegion._id, fcmToken
    };

    if (role === 'shipper') {
      if (!shipperProfile?.vehicleType || !shipperProfile?.licensePlate) {
        return res.status(400).json({ message: 'Thiếu thông tin phương tiện cho shipper' });
      }
      userData.shipperProfile = shipperProfile;
    }

    const user = new User(userData);
    await user.save();

    if (user.role === 'customer') {
      await voucherController.grantNewUserVoucher(user._id);
    }

    const { accessToken, refreshToken } = generateTokens(user._id);

    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(201).json({
      status: 'success',
      data: { user: userResponse, token: accessToken, refreshToken }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ status: 'error', message: err.message || 'Lỗi server' });
  }
};

// Đăng ký tài khoản Seller
exports.registerSeller = async (req, res) => {
    try {
        const { email, password, name, phone, address, regionId } = req.body;
        
        if (!name || !email || !password || !phone || !regionId) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin và chọn khu vực.' });
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
            name, email: email.toLowerCase().trim(), password,
            address: address || '', phone,
            role: 'seller', approvalStatus: 'pending', region: regionId
        });
        
        const savedSeller = await newSeller.save();
        
        // Gửi thông báo cho Admin (tác vụ nền)
        (async () => {
            try {
                const admins = await User.find({ role: 'admin', fcmToken: { $exists: true, $ne: null } });
                if (admins.length > 0) {
                    const title = "Seller mới đăng ký";
                    const body = `Tài khoản "${savedSeller.name}" đang chờ phê duyệt.`;
                    const promises = admins.map(admin => Promise.all([
                        Notification.create({
                            user: admin._id, title, message: body, type: 'general',
                            data: { screen: 'SellerApproval', sellerId: savedSeller._id.toString() }
                        }),
                        safeNotify(admin.fcmToken, {
                            title, body,
                            data: { screen: 'SellerApproval', sellerId: savedSeller._id.toString() }
                        })
                    ]));
                    await Promise.all(promises);
                    console.log(`[New Seller] Sent notifications to ${admins.length} admins.`);
                }
            } catch (e) { console.error("[New Seller] Error sending notification:", e); }
        })();
        
        res.status(201).json({ message: 'Đăng ký thành công! Tài khoản của bạn đang chờ phê duyệt.' });
        
    } catch (error) {
         console.error('[REGISTER SELLER ERROR]:', error);
         res.status(500).json({ message: "Lỗi server khi đăng ký." });
    }
};
