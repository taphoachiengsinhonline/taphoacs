// File: backend/middlewares/authMiddleware.js
// PHIÊN BẢN SỬA LỖI - DÙNG toObject() ĐỂ ĐẢM BẢO AN TOÀN

const jwt = require('jsonwebtoken');
const User = require('../models/User');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Chưa đăng nhập hoặc thiếu token' });
  }

  const token = authHeader.slice(7).trim();
  
  if (!token) {
    return res.status(401).json({ message: 'Token không hợp lệ' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // BƯỚC 1: LẤY TOÀN BỘ USER OBJECT TỪ DB (BAO GỒM CẢ PASSWORD)
    const user = await User.findById(decoded.userId).select('+password');
    
    if (!user) {
      return res.status(401).json({ message: 'Người dùng không tồn tại' });
    }
    
    // BƯỚC 2: CHUYỂN THÀNH PLAIN JAVASCRIPT OBJECT VÀ XÓA PASSWORD
    const userObject = user.toObject();
    delete userObject.password;
    
    // BƯỚC 3: GÁN OBJECT SẠCH VÀO req.user
    req.user = userObject;
    
    next();
  } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn' });
      }
      return res.status(401).json({ message: 'Token không hợp lệ hoặc sai' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    return res.status(403).json({ message: 'Yêu cầu quyền Quản trị viên' });
  }
};

const isSeller = (req, res, next) => {
    if (req.user && req.user.role === 'seller') {
        next();
    } else {
        res.status(403).json({ message: 'Yêu cầu quyền Người bán' });
    }
};

// Hàm protect sẽ được làm nhất quán với verifyToken
const protect = verifyToken;

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Bạn không có quyền thực hiện hành động này' });
    }
    next();
  };
};
const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.userId).select('-password');
                if (user) {
                    req.user = user; // Gán user vào request
                }
            } catch (err) {
                // Bỏ qua lỗi token hết hạn hoặc không hợp lệ, coi như là khách vãng lai
                console.log('Optional auth: Invalid token, proceeding as guest.');
            }
        }
    }
    next(); // Luôn luôn đi tiếp
};



module.exports = {
  verifyToken,
  isAdmin,
  isSeller,
  protect,
  restrictTo,
  isAdminMiddleware: isAdmin,
  verifyAdmin: isAdmin,
  optionalAuth,
};
