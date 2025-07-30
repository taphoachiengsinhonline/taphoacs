const express = require('express');
const router = express.Router();
const Category = require('../models/Category');

// Lấy tất cả danh mục
router.get('/', async (req, res) => {
  try {
    // Sử dụng .lean() để lấy về plain JavaScript object, giúp xử lý nhanh hơn
    const categories = await Category.find({}).lean();

    // Chuẩn hóa dữ liệu trước khi gửi về client
    const normalizedCategories = categories.map(cat => {
      // Nếu có trường 'parent', chuyển nó thành chuỗi ID
      // Nếu không có, nó sẽ là undefined, và ta sẽ để nó là null
      return {
        ...cat,
        parent: cat.parent ? cat.parent.toString() : null
      };
    });

    res.json(normalizedCategories);

  } catch (err) {
    console.error('Lỗi khi lấy danh mục:', err);
    res.status(500).json({ message: 'Lỗi server khi lấy danh mục' });
  }
});

// Tạo danh mục
router.post('/', async (req, res) => {
  try {
    const { name, parent } = req.body;
    // Tìm danh mục đã tồn tại không phân biệt chữ hoa/thường
    const existing = await Category.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
    if (existing) {
      return res.status(400).json({ message: 'Tên danh mục này đã tồn tại.' });
    }

    const newCategory = await Category.create({ name, parent: parent || null });
    res.status(201).json(newCategory);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server khi tạo danh mục' });
  }
});

// Xoá danh mục (Cải tiến để an toàn hơn)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Kiểm tra xem có danh mục con nào đang tham chiếu đến nó không
    const childCount = await Category.countDocuments({ parent: id });
    if (childCount > 0) {
      return res.status(400).json({ message: 'Không thể xóa danh mục này vì nó vẫn còn danh mục con. Vui lòng xóa các danh mục con trước.' });
    }

    // (Tùy chọn) Kiểm tra xem có sản phẩm nào đang dùng danh mục này không
    // const Product = require('../models/Product');
    // const productCount = await Product.countDocuments({ category: id });
    // if (productCount > 0) {
    //   return res.status(400).json({ message: 'Không thể xóa vì vẫn còn sản phẩm thuộc danh mục này.' });
    // }

    const deletedCategory = await Category.findByIdAndDelete(id);
    if (!deletedCategory) {
        return res.status(404).json({ message: 'Không tìm thấy danh mục để xóa.' });
    }

    res.json({ message: 'Đã xoá danh mục thành công' });
  } catch (err) {
    console.error('Lỗi khi xóa danh mục:', err);
    res.status(500).json({ message: 'Lỗi xóa danh mục' });
  }
});

// Thêm route để cập nhật danh mục (thiếu trong file gốc của bạn)
router.put('/:id', async (req, res) => {
    try {
        const { name, parent } = req.body;
        const updatedCategory = await Category.findByIdAndUpdate(
            req.params.id, 
            { name, parent: parent || null },
            { new: true, runValidators: true }
        );
        if (!updatedCategory) {
            return res.status(404).json({ message: 'Không tìm thấy danh mục.' });
        }
        res.json(updatedCategory);
    } catch (err) {
        console.error('Lỗi cập nhật danh mục:', err);
        res.status(500).json({ message: 'Lỗi cập nhật danh mục' });
    }
});


module.exports = router;
