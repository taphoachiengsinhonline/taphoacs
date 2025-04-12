// models/User.js
const userSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Vui lòng nhập tên'] },
  email: { 
    type: String, 
    required: [true, 'Vui lòng nhập email'],
    unique: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Email không hợp lệ']
  },
  phone: {
    type: String,
    required: [true, 'Vui lòng nhập số điện thoại'],
    match: [/^(03|05|07|08|09|01[2|6|8|9])[0-9]{8}$/, 'Số điện thoại không hợp lệ']
  },
  address: {
    type: String,
    required: [true, 'Vui lòng nhập địa chỉ'],
    minlength: [10, 'Địa chỉ phải có ít nhất 10 ký tự']
  },
  password: { type: String, required: [true, 'Vui lòng nhập mật khẩu'] },
  isAdmin: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
