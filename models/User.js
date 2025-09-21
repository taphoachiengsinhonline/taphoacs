// models/User.js
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
    trim: true,
    // SỬ DỤNG VALIDATE TÙY CHỈNH THAY VÌ required/minlength riêng lẻ
    validate: [
        {
            validator: function(value) {
                // Điều kiện 1: Nếu vai trò là customer hoặc shipper, địa chỉ là bắt buộc.
                if (['customer', 'shipper'].includes(this.role)) {
                    return value && value.length > 0;
                }
                // Với các vai trò khác (admin, seller, region_manager), địa chỉ không bắt buộc.
                return true; 
            },
            message: 'Vui lòng nhập địa chỉ.'
        },
        {
            validator: function(value) {
                // Điều kiện 2: Nếu vai trò là customer hoặc shipper, địa chỉ phải đủ 10 ký tự.
                if (['customer', 'shipper'].includes(this.role)) {
                    // Chỉ kiểm tra độ dài nếu địa chỉ được cung cấp
                    return !value || value.length >= 10;
                }
                // Với các vai trò khác, bỏ qua kiểm tra độ dài.
                return true;
            },
            message: 'Địa chỉ phải có ít nhất 10 ký tự.'
        }
    ]
  },
  password: {
    type: String,
    required: [true, 'Vui lòng nhập mật khẩu'],
    select: false
  },
   region: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Region',
        default: null // Sẽ được gán khi đăng ký
    },
  role: {
  type: String,
  // SỬA DÒNG NÀY
  enum: ['customer', 'admin', 'shipper', 'seller', 'region_manager'], 
  default: 'customer'
},
regionManagerProfile: {
    profitShareRate: { // % lợi nhuận mà quản lý vùng được hưởng
        type: Number,
        default: 0,
        min: 0,
        max: 100
    }
  },
managedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null // null nghĩa là được quản lý bởi Admin trung tâm
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
  lastActive: { // Thêm cho customer
    type: Date,
    default: null
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

 rating: { // Trường này đã có, nhưng chúng ta sẽ dùng 2 trường mới cho chi tiết hơn
            type: Number,
            default: 0,
            min: 0,
            max: 5
        },
        // <<< THÊM 2 TRƯỜNG MỚI ĐỂ QUẢN LÝ ĐÁNH GIÁ SHIPPER >>>
        ratingQuantity: {
            type: Number,
            default: 0
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
   avatar: {
    type: String,
    trim: true,
  },
  shopProfile: {
    shopDescription: { type: String, trim: true, default: 'Chào mừng đến với cửa hàng' },
    avatar: { type: String, trim: true },
    coverPhoto: { type: String, trim: true },
    lastActive: { type: Date },
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

userSchema.virtual('isOnline').get(function() {
  if (this.role === 'seller' && this.shopProfile && this.shopProfile.lastActive) {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    return this.shopProfile.lastActive > twoMinutesAgo;
  } else if (this.role === 'customer' && this.lastActive) {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    return this.lastActive > twoMinutesAgo;
  }
  return false;
});

userSchema.pre('save', function(next) {
  if (this.isModified('lastActive') || this.isModified('shopProfile.lastActive')) {
    if (this.role === 'seller') {
      this.shopProfile.lastActive = new Date();
    } else if (this.role === 'customer') {
      this.lastActive = new Date();
    }
  }
  next();
});

// Middleware để cập nhật lastActive khi gửi tin nhắn
userSchema.methods.updateLastActive = async function() {
  console.log(`[DEBUG] Updating lastActive for user ${this._id}, role ${this.role}`);
  try {
    if (this.role === 'seller') {
      this.shopProfile.lastActive = new Date();
    } else if (this.role === 'customer') {
      this.lastActive = new Date();
    }
    await this.save({ validateBeforeSave: false });
    console.log(`[DEBUG] Saved lastActive for user ${this._id}: ${this.role === 'seller' ? this.shopProfile.lastActive : this.lastActive}`);
  } catch (err) {
    console.error(`[DEBUG] Error saving lastActive for user ${this._id}: ${err.message}`);
  }
};

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
userSchema.virtual('shipperProfile.ratingAverage').get(function() {
    return this.shipperProfile.rating;
});
module.exports = mongoose.model('User', userSchema);
