// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
    lowercase: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Email không hợp lệ'
    ]
  },
  phone: {
    type: String,
    required: [true, 'Vui lòng nhập số điện thoại'],
    match: [
      /^(0[35789]|84[35789]|01[2689])(\d{8})$/,
      'Số điện thoại không hợp lệ'
    ]
  },
  address: {
    type: String,
    required: function() {
      return this.role === 'customer'; // Chỉ bắt buộc cho khách hàng
    },
    minlength: [10, 'Địa chỉ phải có ít nhất 10 ký tự']
  },
  password: {
    type: String,
    required: [true, 'Vui lòng nhập mật khẩu'],
    minlength: [6, 'Mật khẩu phải có ít nhất 6 ký tự'],
    select: false
  },
  role: {
    type: String,
    enum: ['customer', 'staff', 'admin'],
    default: 'customer'
  },
  fcmToken: {
    type: String,
    default: null
  },
  deliveryInfo: {
    vehicleType: {
      type: String,
      enum: ['bike', 'car', 'motorbike'],
      required: function() {
        return this.role === 'staff';
      }
    },
    licensePlate: {
      type: String,
      required: function() {
        return this.role === 'staff';
      },
      uppercase: true,
      match: [/^[0-9A-Z]{6,12}$/, 'Biển số xe không hợp lệ']
    },
    location: {
      type: {
        type: String,
        default: 'Point',
        enum: ['Point']
      },
      coordinates: {
        type: [Number],
        required: function() {
          return this.role === 'staff';
        },
        validate: {
          validator: function(coords) {
            return coords.length === 2 && 
                   coords[0] >= -180 && coords[0] <= 180 &&
                   coords[1] >= -90 && coords[1] <= 90;
          },
          message: 'Tọa độ không hợp lệ'
        }
      }
    },
    status: {
      type: String,
      enum: ['available', 'busy', 'offline'],
      default: 'offline',
      required: function() {
        return this.role === 'staff';
      }
    },
    currentOrders: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order'
    }]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index cho truy vấn địa lý
userSchema.index({ 'deliveryInfo.location': '2dsphere' });

// Hash password trước khi lưu
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Ẩn trường nhạy cảm
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.__v;
  delete user.fcmToken;
  return user;
};

// Phương thức kiểm tra password
userSchema.methods.correctPassword = async function(candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword);
};


userSchema.virtual('isAdmin').get(function() {
  return this.role === 'admin';
});


module.exports = mongoose.model('User', userSchema);
