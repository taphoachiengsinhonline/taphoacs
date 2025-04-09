const Category = require('./models/Category');
const User = require('./models/User');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Product = require('./models/Product');
const app = express();
const Order = require('./models/Order'); // Tạo file Order.js tương tự User.js

// Lấy tất cả danh mục
app.get('/categories', async (req, res) => {
  try {
    const categories = await Category.find();
    console.log('>> Trả danh mục:', categories); // 👈 Log debug ở đây
    res.json(categories);
  } catch (err) {
    console.error('>> Lỗi lấy danh mục:', err); // 👈 Log lỗi chi tiết
    res.status(500).json({ message: 'Lỗi server khi lấy danh mục' });
  }
});

// Tạo mới danh mục
app.post('/categories', async (req, res) => {
  const { name } = req.body;
  try {
    const existing = await Category.findOne({ name });
    if (existing) return res.status(400).json({ message: 'Danh mục đã tồn tại' });

    const newCategory = new Category({ name });
    await newCategory.save();
    console.log('>> Danh mục mới:', newCategory); // 👈 Log khi tạo thành công
    res.status(201).json(newCategory);
  } catch (err) {
    console.error('>> Lỗi tạo danh mục:', err); // 👈 Log lỗi
    res.status(500).json({ message: 'Lỗi server khi tạo danh mục' });
  }
});


app.get('/products', async (req, res) => {
  const { category } = req.query;
  const filter = category ? { category } : {};
  const products = await Product.find(filter);
  res.json(products);
});
app.post('/orders', async (req, res) => {
  try {
    const order = new Order(req.body);
    await order.save();
    res.status(201).json({ message: 'Đơn hàng đã được lưu' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lưu đơn hàng' });
  }
});

app.use(cors());
app.use(express.json()); // 👈 Di chuyển lên đây

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
    console.error('Lỗi register:', err);
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
    console.error('Lỗi login:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

mongoose.connect('mongodb+srv://admin:Hunt3rlov3151220041512@taphoa.mx0zl2l.mongodb.net/?retryWrites=true&w=majority&appName=taphoa')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error(err));


app.post('/products', async (req, res) => {
  const product = new Product(req.body);
  await product.save();
  res.json(product);
});

app.listen(3000, () => console.log('Server running on port 3000'));
