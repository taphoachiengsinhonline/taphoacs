// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const Category = require('./models/Category');
const Product = require('./models/Product');
const User = require('./models/User');
const Order = require('./models/Order');

const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const notificationRoutes = require('./routes/NotificationRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// Route chính
app.use('/auth', authRoutes);          // /auth/login, /auth/register
app.use('/users', authRoutes);         // Cập nhật user: PUT /users/:id
app.use('/api/products', productRoutes);
app.use('/notifications', notificationRoutes);

// -------------------- CATEGORY ROUTES --------------------
// Lấy tất cả danh mục (có populate parent)
app.get('/categories', async (req, res) => {
  try {
    const categories = await Category.find().populate('parent', 'name');
    res.json(categories);
  } catch (err) {
    console.error('>> Lỗi lấy danh mục:', err);
    res.status(500).json({ message: 'Lỗi server khi lấy danh mục' });
  }
});

// Tạo mới danh mục (hỗ trợ danh mục con)
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

// Xoá danh mục (xoá cả danh mục con)
app.delete('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Category.deleteMany({ parent: id });            // Xoá danh mục con
    await Category.findByIdAndDelete(id);                 // Xoá chính nó
    res.json({ message: 'Đã xoá danh mục và danh mục con (nếu có)' });
  } catch (err) {
    console.error('Lỗi xoá danh mục:', err);
    res.status(500).json({ message: 'Lỗi server khi xoá danh mục' });
  }
});

// -------------------- PRODUCT ROUTES --------------------
// Lấy sản phẩm (lọc theo danh mục nếu có)
app.get('/products', async (req, res) => {
  const { category } = req.query;
  try {
    const filter = category ? { category } : {};
    const products = await Product.find(filter);
    res.json(products);
  } catch (err) {
    console.error('Lỗi lấy sản phẩm:', err);
    res.status(500).json({ message: 'Lỗi server khi lấy sản phẩm' });
  }
});

// Thêm sản phẩm mới
app.post('/products', async (req, res) => {
  try {
    const product = new Product(req.body);
    await product.save();
    res.status(201).json(product);
  } catch (err) {
    console.error('Lỗi thêm sản phẩm:', err);
    res.status(500).json({ message: 'Lỗi server khi thêm sản phẩm' });
  }
});

// -------------------- ORDER ROUTES --------------------
// Lấy đơn hàng theo userId
app.get('/orders', async (req, res) => {
  try {
    const orders = await Order.find({ user: req.query.userId })
      .populate('items.product')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server khi lấy đơn hàng' });
  }
});

// Tạo đơn hàng mới
app.post('/orders', async (req, res) => {
  try {
    const { items, total, phone, shippingAddress, userId } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Danh sách sản phẩm không hợp lệ' });
    }

    if (!total || total <= 0) {
      return res.status(400).json({ message: 'Tổng tiền không hợp lệ' });
    }

    const productIds = items.map(i => i.productId);
    const products = await Product.find({ _id: { $in: productIds } });

    if (products.length !== items.length) {
      return res.status(400).json({ message: 'Một số sản phẩm không tồn tại' });
    }

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

    const savedOrder = await order.save();
    console.log('Đã lưu đơn hàng:', savedOrder);

    const bulkOps = items.map(item => ({
      updateOne: {
        filter: { _id: item.productId },
        update: { $inc: { stock: -item.quantity } }
      }
    }));

    await Product.bulkWrite(bulkOps);

    res.status(201).json(savedOrder);
  } catch (err) {
    console.error('Lỗi tạo đơn hàng:', err);
    res.status(500).json({
      message: err.message.includes('validation')
        ? 'Dữ liệu không hợp lệ'
        : 'Lỗi server khi tạo đơn hàng',
      error: err.message
    });
  }
});

// -------------------- USER ROUTES --------------------
// Cập nhật thông tin người dùng
app.put('/users/:id', async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { name, phone, address },
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User không tồn tại' });
    }

    res.json(updatedUser);
  } catch (err) {
    console.error('Lỗi cập nhật user:', err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// -------------------- DB & SERVER --------------------
mongoose.connect('mongodb+srv://admin:Hunt3rlov3151220041512@taphoa.mx0zl2l.mongodb.net/?retryWrites=true&w=majority&appName=taphoa')
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

app.listen(3000, () => console.log('🚀 Server running on port 3000'));
