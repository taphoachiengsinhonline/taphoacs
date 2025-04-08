const User = require('./models/User');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Product = require('./models/Product'); // Giữ dòng này
const app = express();

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
