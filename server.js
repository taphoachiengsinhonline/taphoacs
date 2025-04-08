const User = require('./models/User');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Product = require('./models/Product'); // Giữ dòng này
const app = express();
// Đăng ký
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: 'Email đã được đăng ký' });

    const user = new User({ name, email, password });
    await user.save();
    res.status(201).json({ message: 'Đăng ký thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Đăng nhập
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || user.password !== password) {
      return res.status(401).json({ message: 'Sai email hoặc mật khẩu' });
    }
    res.status(200).json({ message: 'Đăng nhập thành công', user });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

app.use(cors());
app.use(express.json());

mongoose.connect('mongodb+srv://admin:Hunt3rlov3151220041512@taphoa.mx0zl2l.mongodb.net/?retryWrites=true&w=majority&appName=taphoa')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error(err));

// ❌ XÓA phần này ↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓
// const Product = mongoose.model('Product', {
//   name: String,
//   price: Number,
//   image: String,
// });

app.get('/products', async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

app.post('/products', async (req, res) => {
  const product = new Product(req.body);
  await product.save();
  res.json(product);
});

app.listen(3000, () => console.log('Server running on port 3000'));
