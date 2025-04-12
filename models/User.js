const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, 'Vui lòng nhập tên'] 
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
      /^(0[35789]|84[35789]|01[2689])([0-9]{8})$/, // ✅ Sửa regex
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
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },  // Ẩn các trường nhạy cảm
  toObject: { virtuals: true }
});

// Ẩn trường password khi trả về JSON
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.__v;
  return user;
};

module.exports = mongoose.model('User', userSchema);
