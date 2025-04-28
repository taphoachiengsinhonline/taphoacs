// routes/cartRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken } = require('../middlewares/authMiddleware');

// DELETE /api/cart/:productId - Xóa sản phẩm khỏi giỏ hàng
router.delete('/:productId', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Lọc ra các sản phẩm không phải productId cần xóa
    user.cart = user.cart.filter(
      item => item.productId.toString() !== req.params.productId
    );

    await user.save();
    
    res.json({ 
      success: true,
      message: 'Đã xóa sản phẩm khỏi giỏ hàng',
      newCart: user.cart 
    });

  } catch (err) {
    console.error('❌ Lỗi xóa sản phẩm:', err);
    res.status(500).json({ 
      success: false,
      message: 'Lỗi server khi xóa sản phẩm' 
    });
  }
});

module.exports = router;
