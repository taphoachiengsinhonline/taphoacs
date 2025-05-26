// models/User.js
const mongoose = require('mongoose');

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
    default: null // ✅ Đổi tên từ expoPushToken ➜ fcmToken
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Ẩn trường nhạy cảm khi trả về client
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  delete user.__v;
  return user;
};

module.exports = mongoose.model('User', userSchema);
