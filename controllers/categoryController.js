// /controllers/categoryController.js

const Category = require('../models/Category');
const Product = require('../models/Product'); // Import Product model để dùng ở hàm mới

// ===============================================
// === CÁC HÀM TƯƠNG ỨNG VỚI ROUTE CŨ CỦA BẠN ===
// ===============================================

// Logic cho route: GET /
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find({}).lean();
    const normalizedCategories = categories.map(cat => ({
      ...cat,
      parent: cat.parent ? cat.parent.toString() : null
    }));
    res.json(normalizedCategories);
  } catch (err) {
    console.error('Lỗi khi lấy danh mục:', err);
    res.status(500).json({ message: 'Lỗi server khi lấy danh mục' });
  }
};

// Logic cho route: POST /
exports.createCategory = async (req, res) => {
  try {
    const { name, parent } = req.body;
    const existing = await Category.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
    if (existing) {
      return res.status(400).json({ message: 'Tên danh mục này đã tồn tại.' });
    }
    const newCategory = await Category.create({ name, parent: parent || null });
    res.status(201).json(newCategory);
  } catch (err) {
    console.error('Lỗi khi tạo danh mục:', err);
    res.status(500).json({ message: 'Lỗi server khi tạo danh mục' });
  }
};

// Logic cho route: DELETE /:id
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const childCount = await Category.countDocuments({ parent: id });
    if (childCount > 0) {
      return res.status(400).json({ message: 'Không thể xóa danh mục này vì nó vẫn còn danh mục con. Vui lòng xóa các danh mục con trước.' });
    }
    const deletedCategory = await Category.findByIdAndDelete(id);
    if (!deletedCategory) {
      return res.status(404).json({ message: 'Không tìm thấy danh mục để xóa.' });
    }
    res.json({ message: 'Đã xoá danh mục thành công' });
  } catch (err) {
    console.error('Lỗi khi xóa danh mục:', err);
    res.status(500).json({ message: 'Lỗi xóa danh mục' });
  }
};

// Logic cho route: PUT /:id
exports.updateCategory = async (req, res) => {
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
};

// ===============================================
// === HÀM MỚI CHO TÍNH NĂNG "CỬA HÀNG SELLER" ===
// ===============================================

// Logic cho route: GET /by-seller
exports.getCategoriesBySeller = async (req, res) => {
  try {
      const { sellerId } = req.query;
      if (!sellerId) {
          return res.status(400).json({ message: 'Vui lòng cung cấp ID của người bán.' });
      }

      const distinctCategoryIds = await Product.distinct('category', { 
          seller: sellerId,
          approvalStatus: 'approved'
      });
      
      if (distinctCategoryIds.length === 0) {
          return res.json([]);
      }

      const categories = await Category.find({
          _id: { $in: distinctCategoryIds }
      }).select('name parent').lean(); // Dùng lean() để tối ưu

      res.json(categories);

  } catch (error) {
      console.error('Lỗi khi lấy danh mục theo người bán:', error);
      res.status(500).json({ message: 'Lỗi server' });
  }
};
