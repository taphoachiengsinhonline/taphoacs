const mongoose = require('mongoose');

// Phần schema cơ bản ban đầu
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
    required: [true, 'Vui lòng nhập mật khẩu']
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  fcmToken: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.__v;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Thêm các trường mở rộng bằng schema.add()
userSchema.add({
  role: {
    type: String,
    enum: ['customer', 'admin', 'shipper'],
    default: 'customer'
  },
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
  isAvailable: {
    type: Boolean,
    default: true
  },
  shipperProfile: {
    vehicleType: {
      type: String,
      enum: ['bike', 'motorbike', 'car']
    },
    licensePlate: String,
    status: {
      type: String,
      enum: ['available', 'busy', 'offline'],
      default: 'offline'
    },
    rating: {
      type: Number,
      default: 5.0,
      min: 1,
      max: 5
    }
  }
});

// Tạo index cho truy vấn địa lý
userSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', userSchema);
