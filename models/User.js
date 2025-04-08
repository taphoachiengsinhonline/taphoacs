const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String, // bạn có thể hash sau này
});

module.exports = mongoose.model('User', userSchema);

