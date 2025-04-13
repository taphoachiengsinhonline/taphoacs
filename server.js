const Category = require('./models/Category');
const User = require('./models/User');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Product = require('./models/Product');
const app = express();
const Order = require('./models/Order'); // Tạo file Order.js tương tự User.js
const notificationRoutes = require('./routes/NotificationRoutes');

app.use('/auth', require('./routes/authRoutes'));
app.use('/notifications', notificationRoutes);
app.use('/api/products', require('./routes/productRoutes'));
app.use(cors());
app.use(express.json()); // 👈 Di chuyển lên đây
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});
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

app.get('/orders', async (req, res) => {
  try {
    const orders = await Order.find({ user: req.query.userId })
      .populate('items.product')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Tạo mới danh mục

app.post('/categories', async (req, res) => {
  const { name, parent } = req.body;
  try {
    const existing = await Category.findOne({ name });
    if (existing) return res.status(400).json({ message: 'Danh mục đã tồn tại' });

    const newCategory = new Category({ name, parent: parent || null });
    await newCategory.save();
    res.status(201).json(newCategory);
  } catch (err) {
    console.error('>> Lỗi tạo danh mục:', err);
    res.status(500).json({ message: 'Lỗi server khi tạo danh mục' });
  }
});


app.get('/categories', async (req, res) => {
  try {
    const categories = await Category.find().populate('parent', 'name');
    res.json(categories);
  } catch (err) {
    console.error('Lỗi lấy danh mục:', err);
    res.status(500).json({ message: 'Lỗi server khi lấy danh mục' });
  }
});

app.delete('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Xoá danh mục con trước (nếu có)
    await Category.deleteMany({ parent: id });

    // Xoá chính danh mục đó
    await Category.findByIdAndDelete(id);
    res.json({ message: 'Đã xoá danh mục và danh mục con (nếu có)' });
  } catch (err) {
    console.error('Lỗi xoá danh mục:', err);
    res.status(500).json({ message: 'Lỗi server khi xoá danh mục' });
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
    const { items, total, phone, shippingAddress, userId } = req.body;

    // 1. Validate input
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Danh sách sản phẩm không hợp lệ' });
    }
    
    if (!total || total <= 0) {
      return res.status(400).json({ message: 'Tổng tiền không hợp lệ' });
    }

    // 2. Check product existence
    const productIds = items.map(i => i.productId);
    const products = await Product.find({ _id: { $in: productIds } });
    
    if (products.length !== items.length) {
      return res.status(400).json({ message: 'Một số sản phẩm không tồn tại' });
    }

    // 3. Create order
    const order = new Order({
      user: userId,
      items: items.map(item => ({
        product: item.productId,
        quantity: item.quantity,
        price: item.price
      })),
      total,
      phone,
      shippingAddress,
      status: 'pending'
    });

    // 4. Save order
    const savedOrder = await order.save();
    console.log('Đã lưu đơn hàng:', savedOrder);

    // 5. Update stock
    const bulkOps = items.map(item => ({
      updateOne: {
        filter: { _id: item.productId },
        update: { $inc: { stock: -item.quantity } }
      }
    }));
    
    await Product.bulkWrite(bulkOps);

    res.status(201).json(savedOrder);

  } catch (err) {
    console.error('Lỗi chi tiết:', err);
    res.status(500).json({ 
      message: err.message.includes('validation') 
        ? 'Dữ liệu không hợp lệ' 
        : 'Lỗi server khi tạo đơn hàng',
      error: err.message
    });
  }
});



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
// server.js
app.put('/users/:id', async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    
    // Cập nhật và trả về user mới
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { name, phone, address },
      { new: true } // <- Quan trọng: trả về document sau khi update
    ).select('-password'); // Loại bỏ trường password

    if (!updatedUser) {
      return res.status(404).json({ message: 'User không tồn tại' });
    }

    res.json(updatedUser);

  } catch (err) {
    console.error('Lỗi cập nhật user:', err);
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
