const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Tên người dùng là bắt buộc'],
    trim: true,
    minlength: [2, 'Tên phải có ít nhất 2 ký tự']
  },
  email: {
    type: String,
    required: [true, 'Vui lòng nhập email'],
    unique: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Email không hợp lệ'
    ]
  },
  phone: {
    type: String,
    required: [true, 'Vui lòng nhập số điện thoại'],
    match: [
      /^(0[35789]|84[35789]|01[2689])([0-9]{8})$/,
      'Số điện thoại phải bắt đầu bằng: 03/05/07/08/09/012/016/018/019 hoặc +84'
    ]
  },
  address: {
    type: String,
    required: [true, 'Vui lòng nhập địa chỉ'],
    minlength: [10, 'Địa chỉ phải có ít nhất 10 ký tự']
  },
  password: {
    type: String,
    required: [true, 'Vui lòng nhập mật khẩu'],
    select: false
  },
  
  role: {
  type: String,
  // SỬA DÒNG NÀY
  enum: ['customer', 'admin', 'shipper', 'seller'], 
  default: 'customer'
},
commissionRate: { // <-- THÊM MỚI Ở ĐÂY
    type: Number,
    default: 0, 
    min: 0,
    max: 100
},
approvalStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'approved' // Mặc định là 'approved' cho các tài khoản cũ và shipper/admin
    },
rejectionReason: String,
  
  fcmToken: String,
  expoPushToken: { type: String },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    }
  },
  locationUpdatedAt: Date,
  isAvailable: {
    type: Boolean,
    default: true
  },
  shipperProfile: {
    vehicleType: {
    type: String,
    required: function() { 
      return this.role === 'shipper'; // Required khi role là shipper
    },
    enum: ['bike', 'motorbike', 'car'] // Đúng giá trị cho phép
  },
  licensePlate: {
    type: String,
    required: function() { 
      return this.role === 'shipper'; 
    }
  },


   shippingFeeShareRate: { // % chiết khấu trên phí ship
        type: Number,
        default: 70, // Ví dụ: Mặc định shipper nhận 70% phí ship
        min: 0,
        max: 100
    },
   profitShareRate: { // % shipper được hưởng trên lợi nhuận của admin
        type: Number,
        default: 0, 
        min: 0,
        max: 100
    },

 rating: {
      type: Number,
      default: 5.0,
      min: 1,
      max: 5
    }
  },
  fcmToken: {
    type: String,
    default: null
  },

  paymentInfo: {
    bankName: { type: String, trim: true },
    accountHolderName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
  },
  shopProfile: {
    shopDescription: { type: String, trim: true, default: 'Chào mừng đến với cửa hàng' },
    avatar: { type: String, trim: true },
    coverPhoto: { type: String, trim: true },
  },
  sellerProfile: {
      autoResponseMessage: {
          type: String,
          trim: true,
          maxLength: [500, 'Tin nhắn tự động không được quá 500 ký tự.']
      }
  }
  
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function (doc, ret) {
      delete ret.password;
      delete ret.__v;
      ret.isAdmin = ret.role === 'admin'; // Thêm virtual field
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Hash password trước khi lưu
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const hashedPassword = await bcrypt.hash(this.password, 12);
    this.password = hashedPassword;
    next();
  } catch (error) {
    next(new Error(`Lỗi hash password: ${error.message}`));
  }
});

// Validate thông tin shipper
userSchema.pre('validate', function (next) {
  if (this.role === 'shipper') {
    if (!this.shipperProfile?.vehicleType) {
      this.invalidate('shipperProfile.vehicleType', 'Shipper phải có phương tiện');
    }
    if (!this.location?.coordinates?.length) {
      this.invalidate('location.coordinates', 'Shipper phải có tọa độ địa lý');
    }
  }
  next();
});

// Tạo index cho truy vấn địa lý
userSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', userSchema);
